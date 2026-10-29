"""
CEO (Super Boss) - the main router.

Routes a user task to the best boss:

  1. keyword scoring against each boss's worker map
  2. if nobody matches -> the Mother Agent creates a specialist
  3. if a boss escalates (worker failed 2 times) -> try the next best
     boss, and if all fail, fall back to the Mother Agent

The bosses/ and workers/ directories are re-scanned on demand, so
dynamically created agents are picked up on the next task.
"""
from __future__ import annotations

import importlib
import uuid
from pathlib import Path

from brain import registry
from brain import mother_agent
from memory import log_manager

ROOT = Path(__file__).resolve().parents[1]

_ESCALATIONS: list = []  # mailbox read by the dashboard / main.py
_MAX_ESCALATIONS = 50


def escalate(from_agent: str, task: dict, error: str | None, reason: str = "") -> dict:
    """Post an escalation record to the CEO mailbox."""
    record = {
        "from": from_agent,
        "task_id": task.get("id"),
        "action": task.get("action"),
        "error": error,
        "reason": reason,
    }
    _ESCALATIONS.append(record)
    del _ESCALATIONS[:-_MAX_ESCALATIONS]
    return record


def pending_escalations() -> list:
    return list(_ESCALATIONS)


def _classes_in(module_name: str, suffix: str):
    """Find the agent class (…Boss / …Worker) defined in a module."""
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:  # a broken agent file must not kill the CEO
        # Deliberately NOT registered: a module that fails to import is not
        # an agent — showing it on the dashboard would be a ghost entry.
        import sys

        print(f"[ceo] skip {module_name}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return []
    found = []
    for value in vars(module).values():
        if (
            isinstance(value, type)
            and value.__module__ == module.__name__
            and value.__name__.lower().endswith(suffix.lower())
        ):
            found.append(value)
    return found


def discover_bosses() -> dict:
    """Scan bosses/*.py and return {agent_name: boss_class}."""
    out = {}
    for file in sorted((ROOT / "bosses").glob("*.py")):
        if file.name.startswith("_") or file.name == "base_boss.py":
            continue
        for cls in _classes_in(f"bosses.{file.stem}", "boss"):
            out[cls.name] = cls
    return out


def discover_workers() -> dict:
    """Scan workers/*.py and return {agent_name: worker_class}."""
    out = {}
    for file in sorted((ROOT / "workers").glob("*.py")):
        if file.name.startswith("_") or file.name == "base_worker.py":
            continue
        for cls in _classes_in(f"workers.{file.stem}", "worker"):
            out[cls.name] = cls
    return out


def seed_registry() -> None:
    """Register every discovered agent so the dashboard shows the org chart."""
    for name, cls in discover_bosses().items():
        registry.register_agent(
            name, "boss", source_file=cls.__module__,
            workers=[worker.name for worker in cls.workers.values()],
        )
    for name, cls in discover_workers().items():
        registry.register_agent(name, "worker", source_file=cls.__module__)


def instantiate_agent(role: str, name: str):
    """Import and instantiate a dynamically created agent."""
    package = "bosses" if role == "boss" else "workers"
    classes = _classes_in(f"{package}.{name}", "boss" if role == "boss" else "worker")
    return classes[0]() if classes else None


class SuperBoss:
    """CEO: routes tasks, tracks escalations, delegates to the Mother Agent."""

    def __init__(self):
        seed_registry()
        registry.register_agent("ceo_super_boss", "boss", ceo=True)
        self.bosses = discover_bosses()

    def score(self, boss_cls, task: dict) -> int:
        """Keyword score: how well does this boss fit the task?"""
        text = " ".join(
            str(task.get(key) or "") for key in ("action", "prompt", "content")
        ).lower()
        score = 0
        for keyword in boss_cls.workers:
            if keyword in text:
                score += 1
        if boss_cls.name.replace("_boss", "") in text:
            score += 2
        return score

    async def run_task(self, prompt: str) -> dict:
        task_id = uuid.uuid4().hex[:8]
        task = {
            "id": task_id,
            "action": (prompt.split() or [""])[0],
            "prompt": prompt,
        }
        registry.task_started(task_id, "ceo_super_boss", "route")

        ranked = sorted(
            self.bosses.items(),
            key=lambda item: self.score(item[1], task),
            reverse=True,
        )
        last_error = None
        for name, boss_cls in ranked:
            if self.score(boss_cls, task) == 0:
                break  # zero score means no keyword overlap at all
            try:
                result = await boss_cls().assign_task(task)
            except Exception as exc:
                registry.set_status(name, "error", str(exc))
                result = {"ok": False, "error": str(exc)}
            last_error = result.get("error")
            if result.get("ok"):
                registry.task_finished(task_id, ok=True)
                log_manager.log_task(
                    task_id, "ceo_super_boss", "route", "ok",
                    payload={"boss": name, "result": result.get("result")},
                )
                return {**result, "boss": name, "task_id": task_id}
            if result.get("escalated"):
                # Worker failed twice under this boss -> log and try next.
                log_manager.log_task(
                    task_id, "ceo_super_boss", "escalation", "error",
                    payload={"boss": name, "error": last_error},
                )

        # No boss matched or all failed -> Mother Agent hires a specialist.
        created = await mother_agent.create_agent_for_task(task)
        if created:
            if created.get("exists"):
                agent_name = created["name"]
            else:
                self.bosses = discover_bosses()  # pick up the new file
                agent_name = created["name"]
            agent = instantiate_agent(created["role"], agent_name)
            if agent is not None:
                try:
                    if created["role"] == "boss":
                        result = await agent.assign_task(task)
                    else:
                        result = await agent.run(task)
                except Exception as exc:
                    result = {"ok": False, "error": str(exc)}
                if result.get("ok"):
                    registry.task_finished(task_id, ok=True)
                    return {**result, "agent": agent_name, "task_id": task_id, "created": True}
                registry.task_finished(task_id, ok=False, error=result.get("error"))
                return {**result, "agent": agent_name, "task_id": task_id, "created": True}

        registry.task_finished(
            task_id, ok=False,
            error=last_error or "No boss could handle the task",
        )
        return {
            "ok": False,
            "task_id": task_id,
            "error": last_error or "No boss could handle the task",
        }
