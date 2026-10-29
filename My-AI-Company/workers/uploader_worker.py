"""
Uploader worker.

Out of the box it stages the artifact into workspace/uploads/. For a
real platform upload (YouTube/TikTok) plug the platform SDK inside
do_task — the seam is kept so nothing else in the company changes.
"""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from workers.base_worker import BaseWorker, WorkerError

WORKSPACE = Path(__file__).resolve().parents[1] / "workspace"


class UploaderWorker(BaseWorker):
    name = "uploader_worker"
    role = "worker"

    async def do_task(self, task: dict) -> dict:
        src = task.get("file") or task.get("input")
        target = task.get("target", "local")
        if not src:
            raise WorkerError("uploader needs a file/input")

        src_path = Path(src)
        if not src_path.is_absolute():
            src_path = WORKSPACE.parent / src_path
        if not src_path.exists():
            raise WorkerError(f"file not found: {src_path}")

        if target == "local":
            dest_dir = WORKSPACE / "uploads"
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / src_path.name
            await asyncio.to_thread(shutil.copy2, str(src_path), str(dest))
            return {
                "ok": True,
                "result": {
                    "staged": str(dest),
                    "note": "platform upload: plug the platform SDK here",
                },
            }
        raise WorkerError(f"unsupported upload target: {target}")
