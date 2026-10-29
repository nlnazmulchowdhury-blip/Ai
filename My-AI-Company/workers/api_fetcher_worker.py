"""
No-API web fetcher.

Talks to the FREE web UIs of Gemini / DeepSeek / ChatGPT through one
reused Playwright browser. The user logs in themselves once; this
worker never touches credentials.

Parallel rule (company charter): ALL configured providers are queried
at the SAME time with asyncio.wait(FIRST_COMPLETED). The first provider
that answers with a VALID JSON object (via json_fixer.extract_json)
wins and the rest are cancelled.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from brain import json_fixer
from tools import browser_controller
from workers.base_worker import BaseWorker, WorkerError

_SETTINGS = Path(__file__).resolve().parents[1] / "config" / "settings.json"


def _load_settings() -> dict:
    return json.loads(_SETTINGS.read_text(encoding="utf-8"))


async def _ask_provider(page, provider_cfg: dict, prompt: str, per_provider_s: int):
    """Drive one provider page: fill prompt, submit, wait for reply, extract JSON."""
    timeout_ms = per_provider_s * 1000
    await browser_controller.goto_and_wait(
        page,
        provider_cfg["url"],
        provider_cfg.get("prompt_selectors", []),
        timeout_ms=timeout_ms,
    )
    await page.locator(provider_cfg["prompt_selectors"][0]).first.fill(prompt)
    if provider_cfg.get("submit_strategy") == "enter":
        await page.keyboard.press("Enter")

    response_text = ""
    for selector in provider_cfg.get("response_selectors", []):
        try:
            # wait_for_selector, never sleep — the no-sleep rule lives here
            await page.wait_for_selector(selector, timeout=timeout_ms)
            text = await page.locator(selector).last.inner_text()
            if text.strip():
                response_text = text
                break
        except Exception:
            continue
    if not response_text.strip():
        raise WorkerError("provider answered with empty text")
    return json_fixer.extract_json(response_text)


class ApiFetcherWorker(BaseWorker):
    name = "api_fetcher_worker"
    role = "worker"

    async def do_task(self, task: dict) -> dict:
        settings = _load_settings()
        prompt = task.get("prompt") or task.get("content") or ""
        hint = task.get("hint")
        full_prompt = f"{prompt}\n\n{settings['prompts']['json_instruction']}"
        if hint:
            full_prompt += f"\n\n{hint}"

        per_provider = settings["timeouts"]["per_provider_s"]
        total = settings["timeouts"]["api_fetch_total_s"]

        # Launch every provider in parallel on the shared browser.
        tasks: dict = {}
        for name, cfg in settings["providers"].items():
            page = await browser_controller.new_page()
            tasks[name] = asyncio.create_task(
                _ask_provider(page, cfg, full_prompt, per_provider)
            )
        pending = set(tasks.values())
        winner, errors = None, {}

        # First provider with valid JSON wins.
        while pending:
            done, pending = await asyncio.wait(
                pending, timeout=total, return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                break
            for finished in done:
                name = next(n for n, t in tasks.items() if t is finished)
                try:
                    winner = await finished
                except Exception as exc:
                    errors[name] = f"{type(exc).__name__}: {exc}"
                    continue
                break
            if winner is not None:
                break

        for running in pending:
            running.cancel()

        if winner is None:
            raise WorkerError(
                "No provider returned valid JSON: "
                + json.dumps(errors, ensure_ascii=False)
            )
        return {"ok": True, "result": winner}
