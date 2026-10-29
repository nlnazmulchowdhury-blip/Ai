"""
Abstract boss - the template every boss inherits.

Responsibilities:

  * assign_task(): route the task to the right worker and run it
  * check_worker(): read a worker's live status from the registry
  * report_to_ceo(): escalate to the CEO (super_boss) when a worker
    fails MAX_WORKER_FAILURES (2) times in a row

Escalation rule (required by the company charter):
    worker fails attempt 1 -> retry once with the error as a hint
    worker fails attempt 2 -> report_to_ceo() and return escalated=True
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from brain import registry
from memory import log_manager

MAX_WORKER_FAILURES = 2


class BossError(Exception):
    """Raised when a boss cannot handle a task at all."""


class BaseBoss(ABC):
    name = "base_boss"
    role = "boss"
    # task-type keyword -> worker class (concrete bosses override this)
    workers: dict = {}

    def __init__(self):
        registry.register_agent(
            self.name,
            self.role,
            workers=[worker_cls.name for worker_cls in self.workers.values()],
        )

    def worker_for(self, task: dict):
        """Pick the worker class whose keyword matches the task text."""
        text = " ".join(
            str(task.get(key) or "") for key in ("action", "type", "prompt", "content")
        ).lower()
        for keyword, worker_cls in self.workers.items():
            if keyword in text:
                return worker_cls
        return next(iter(self.workers.values()), None)

    def check_worker(self, worker_name: str):
        """Return the worker's live registry record (or None)."""
        for agent in registry.snapshot()["agents"]:
            if agent["name"] == worker_name:
                return agent
        return None

    async def assign_task(self, task: dict) -> dict:
        """Run the task through the best worker, with the 2-failure rule."""
        worker_cls = self.worker_for(task)
        if worker_cls is None:
            raise BossError(f"{self.name} has no worker for task: {task}")

        attempts = 0
        last_result = None
        while attempts < MAX_WORKER_FAILURES:
            attempts += 1
            worker = worker_cls()
            last_result = await worker.run(task)
            if last_result.get("ok"):
                return last_result
            # Feed the failure back so the next attempt can adapt.
            task = {
                **task,
                "hint": f"Previous attempt failed: {last_result.get('error')}",
            }

        # Two failed attempts -> the CEO must know.
        await self.report_to_ceo(task, last_result)
        return {**last_result, "escalated": True, "boss": self.name}

    async def report_to_ceo(self, task: dict, failure: dict) -> dict:
        """Escalate a worker that failed MAX_WORKER_FAILURES times."""
        from brain.super_boss import escalate  # lazy: avoids circular import

        record = escalate(
            from_agent=self.name,
            task=task,
            error=failure.get("error"),
            reason=f"worker failed {MAX_WORKER_FAILURES} times in a row",
        )
        log_manager.log_task(
            task_id=task.get("id", "?"),
            agent=self.name,
            action="escalate_to_ceo",
            status="error",
            payload={"escalation": record},
        )
        return record

    @abstractmethod
    def handle(self, task: dict) -> str:
        """Human-readable description of what this boss does with a task."""
        raise NotImplementedError
