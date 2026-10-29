"""
Downloads a URL to the workspace.

Uses requests via asyncio.to_thread so the event loop never blocks.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import requests

from workers.base_worker import BaseWorker, WorkerError

DOWNLOAD_DIR = Path(__file__).resolve().parents[1] / "workspace"


class DownloaderWorker(BaseWorker):
    name = "downloader_worker"
    role = "worker"

    async def do_task(self, task: dict) -> dict:
        url = task.get("url")
        if not url:
            raise WorkerError("downloader needs a url")
        dest = task.get("dest") or Path(url.split("?")[0]).name or "download.bin"
        out_path = DOWNLOAD_DIR / dest
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

        def _fetch() -> int:
            with requests.get(url, stream=True, timeout=60) as response:
                response.raise_for_status()
                with open(out_path, "wb") as handle:
                    for chunk in response.iter_content(chunk_size=1 << 16):
                        handle.write(chunk)
            return out_path.stat().st_size

        size = await asyncio.to_thread(_fetch)
        return {"ok": True, "result": {"path": str(out_path), "bytes": size}}
