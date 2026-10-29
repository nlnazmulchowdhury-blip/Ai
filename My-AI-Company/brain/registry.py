"""
In-memory runtime registry shared by agents and the dashboard.

Holds agent status (online / busy / error / idle), counters, last error
and the recent task list. The dashboard polls snapshot() via /api/state.
"""
from __future__ import annotations

import time

VALID_STATUS = {"online", "busy", "error", "idle"}

_AGENTS: dict = {}  # name -> agent record
_TASKS: list = []   # recent task records (newest last)
_MAX_TASKS = 200


def register_agent(name: str, role: str, source_file: str = "", workers=None, ceo: bool = False) -> dict:
    """Register (or return) an agent record. Called by base classes on init."""
    if name in _AGENTS:
        agent = _AGENTS[name]
        if workers:
            agent["workers"] = workers
        return agent
    _AGENTS[name] = {
        "name": name,
        "role": role,
        "status": "online",
        "source_file": source_file,
        "workers": workers or [],
        "ceo": ceo,
        "tasks_done": 0,
        "failures": 0,
        "last_error": None,
        "updated_at": time.time(),
    }
    return _AGENTS[name]


def set_status(name: str, status: str, error: str | None = None):
    """Update an agent's status; unknown agents are registered on the fly."""
    if status not in VALID_STATUS:
        status = "error"
    agent = _AGENTS.get(name)
    if agent is None:
        agent = register_agent(name, "unknown", ceo=False)
    agent["status"] = status
    agent["updated_at"] = time.time()
    if error:
        agent["last_error"] = error
        if status == "error":
            agent["failures"] += 1


def task_started(task_id: str, agent: str, action: str) -> dict:
    record = {
        "id": task_id,
        "agent": agent,
        "action": action,
        "status": "busy",
        "started_at": time.time(),
        "finished_at": None,
        "error": None,
    }
    _TASKS.append(record)
    del _TASKS[:-_MAX_TASKS]
    set_status(agent, "busy")
    return record


def task_finished(task_id: str, ok: bool = True, error: str | None = None):
    for record in reversed(_TASKS):
        if record["id"] == task_id:
            record["status"] = "ok" if ok else "error"
            record["error"] = error
            record["finished_at"] = time.time()
            set_status(record["agent"], "online" if ok else "error", error)
            if ok:
                agent = _AGENTS.get(record["agent"])
                if agent:
                    agent["tasks_done"] += 1
            return record
    return None


def snapshot() -> dict:
    """Full state for the dashboard."""
    return {
        "agents": list(_AGENTS.values()),
        "tasks": list(_TASKS[-30:]),
        "generated_at": time.time(),
    }
