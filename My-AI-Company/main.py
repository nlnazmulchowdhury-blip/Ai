"""
Entry point: starts the dashboard server and the CEO (Super Boss).

Usage:
    python main.py                    # dashboard + interactive prompt loop
    python main.py --task "..."       # run one task and exit
    python main.py --no-dashboard     # skip the HTTP server
"""
from __future__ import annotations

import argparse
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from brain import registry
from brain.super_boss import SuperBoss

ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = ROOT / "dashboard"
SETTINGS = json.loads((ROOT / "config" / "settings.json").read_text(encoding="utf-8"))

DEFAULT_HOST = SETTINGS.get("dashboard", {}).get("host", "127.0.0.1")
DEFAULT_PORT = SETTINGS.get("dashboard", {}).get("port", 8088)


class Handler(BaseHTTPRequestHandler):
    """Serves /api/state (live registry) and the static dashboard."""

    def do_GET(self):  # noqa: N802 (http.server naming)
        path = urlparse(self.path).path
        if path == "/api/state":
            body = json.dumps(registry.snapshot(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        relative = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
        file_path = DASHBOARD_DIR / relative
        if file_path.is_file() and DASHBOARD_DIR in file_path.parents:
            content_type = {
                ".html": "text/html",
                ".js": "application/javascript",
                ".css": "text/css",
            }.get(file_path.suffix, "application/octet-stream")
            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_error(404)

    def log_message(self, *_args):
        pass  # keep the console clean; task logs live in memory/logs/


def start_dashboard(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[dashboard] http://{host}:{port}")
    return server


async def run_one(ceo: SuperBoss, prompt: str) -> None:
    result = await ceo.run_task(prompt)
    print(json.dumps(result, ensure_ascii=False, indent=2))


async def interactive(ceo: SuperBoss) -> None:
    """Read tasks from stdin without blocking the event loop."""
    print("[ceo] Super Boss online. Type a task (or 'quit').")
    loop = asyncio.get_running_loop()
    while True:
        try:
            prompt = await loop.run_in_executor(None, input, "task> ")
        except EOFError:
            return
        prompt = prompt.strip()
        if not prompt:
            continue
        if prompt.lower() in ("quit", "exit"):
            return
        await run_one(ceo, prompt)


async def main() -> None:
    args = parse_args()
    ceo = SuperBoss()
    server = None
    if not args.no_dashboard:
        server = start_dashboard(port=args.port or DEFAULT_PORT)
    if args.task:
        await run_one(ceo, args.task)
    else:
        await interactive(ceo)
    if server is not None:
        server.shutdown()

    from tools import browser_controller  # lazy: only needed if it ever started
    await browser_controller.close_browser()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="My AI Company")
    parser.add_argument("--task", help="run one task and exit")
    parser.add_argument("--no-dashboard", action="store_true", help="skip the HTTP server")
    parser.add_argument("--port", type=int, default=None, help="dashboard port override")
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(main())
