"""
Video cutting / rendering via ffmpeg.

Runs ffmpeg as a subprocess (asyncio.create_subprocess_exec), so the
event loop stays free. ffmpeg must be installed on the machine.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from workers.base_worker import BaseWorker, WorkerError

WORKSPACE = Path(__file__).resolve().parents[1] / "workspace"


class CutterWorker(BaseWorker):
    name = "cutter_worker"
    role = "worker"

    async def do_task(self, task: dict) -> dict:
        src = task.get("input") or task.get("src")
        start = task.get("start")
        end = task.get("end")
        out = task.get("output") or "cut.mp4"
        if not src or start is None or end is None:
            raise WorkerError("cutter needs input, start and end (seconds)")

        src_path = Path(src)
        if not src_path.is_absolute():
            src_path = WORKSPACE.parent / src_path
        out_path = Path(out)
        if not out_path.is_absolute():
            out_path = WORKSPACE / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start), "-to", str(end),
            "-i", str(src_path),
            "-c", "copy",
            str(out_path),
        ]
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise WorkerError(stderr.decode(errors="replace")[-800:])
        return {"ok": True, "result": {"path": str(out_path)}}
