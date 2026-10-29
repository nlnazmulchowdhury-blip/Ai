"""
Abstract worker - the template every worker inherits.

Every worker implements do_task(task). The base class provides:

  * retry loop: on json_fixer.FixerError the provider is asked again
    with a "reply with valid JSON only" hint appended to the prompt
  * smart cache integration (destructive actions are never cached)
  * auto-logging of every task to memory/logs/
  * registry status updates (busy while working, online/error after)
"""
from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod

from brain import registry
from brain import json_fixer
from memory import cache_manager
from memory import log_manager


class WorkerError(Exception):
    """Raised when a worker cannot complete the task."""


class BaseWorker(ABC):
    name = "base_worker"
    role = "worker"

    def __init__(self):
        registry.register_agent(self.name, self.role)

    @abstractmethod
    async def do_task(self, task: dict) -> dict:
        """Perform the task. Return {"ok": bool, "result": ..., "error": str}."""

    async def run(self, task: dict) -> dict:
        """Public entry point used by bosses: cache + retry + logging."""
        task_id = task.get("id") or uuid.uuid4().hex[:8]
        task["id"] = task_id
        action = task.get("action", self.name)
        content = task.get("content") or task.get("payload") or task

        # Read cache first (cache_manager skips destructive actions).
        cached = cache_manager.get(action, content)
        if cached is not None:
            registry.task_started(task_id, self.name, action)
            registry.task_finished(task_id, ok=True)
            return {"ok": True, "result": cached, "cached": True}

        registry.task_started(task_id, self.name, action)
        last_error = None
        for _attempt in range(1, task.get("max_retries", 2) + 1):
            try:
                result = await self.do_task(task) or {}
                result.setdefault("ok", True)
                if result.get("ok"):
                    cache_manager.put(action, content, result.get("result", result))
                registry.task_finished(task_id, ok=result.get("ok"), error=result.get("error"))
                self.log_result(task, result)
                return result
            except json_fixer.FixerError as exc:
                # Invalid JSON reply -> retry with the hint embedded.
                last_error = str(exc)
                task = {**task, "hint": exc.retry_hint}
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"

        registry.task_finished(task_id, ok=False, error=last_error)
        result = {"ok": False, "error": last_error}
        self.log_result(task, result)
        return result

    def log_result(self, task: dict, result: dict) -> dict:
        """Auto-log every task outcome to memory/logs/."""
        return log_manager.log_task(
            task_id=task.get("id", "?"),
            agent=self.name,
            action=task.get("action", self.name),
            status="ok" if result.get("ok") else "error",
            payload=result.get("result"),
            error=result.get("error"),
        )
