"""
Smart short-term cache.

Key = md5(action + normalized content). Rules enforced:

  * destructive actions (delete/remove/move/rename/clear/purge) are
    NEVER cached — a delete must always hit the disk for real
  * every entry stores the action it was created for; a mismatch
    (e.g. cached "create" but now "delete") invalidates the entry
  * entries expire after `ttl_s` so stale answers die on their own
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

STORE = Path(__file__).resolve().parent / "short_term_memory.json"
DEFAULT_TTL_S = 6 * 3600
NEVER_CACHE = {"delete", "remove", "move", "rename", "clear", "purge", "rm", "del"}


def _load() -> dict:
    if not STORE.exists():
        return {}
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save(data: dict) -> None:
    STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize(content) -> str:
    """One canonical string for any content type."""
    if isinstance(content, (dict, list)):
        return json.dumps(content, ensure_ascii=False, sort_keys=True)
    return " ".join(str(content).split()).lower()


def _key(action: str, content) -> str:
    return hashlib.md5(f"{action}::{_normalize(content)}".encode("utf-8")).hexdigest()


def get(action: str, content):
    """Return the cached result, or None on miss / mismatch / expiry."""
    if action.lower() in NEVER_CACHE:
        return None
    data = _load()
    entry = data.get(_key(action, content))
    if not entry:
        return None
    if entry.get("action") != action:
        return None  # action mismatch: cached result belongs to another action
    if time.time() - entry.get("ts", 0) > DEFAULT_TTL_S:
        return None
    return entry.get("result")


def put(action: str, content, result) -> None:
    """Store a result. Destructive actions are skipped by design."""
    if action.lower() in NEVER_CACHE:
        return
    data = _load()
    data[_key(action, content)] = {"action": action, "result": result, "ts": time.time()}
    _save(data)


def invalidate(action: str | None = None, content=None) -> None:
    """Drop one entry (by content), all entries of an action, or everything."""
    data = _load()
    if action is None and content is None:
        _save({})
        return
    if content is not None:
        data.pop(_key(action or "", content), None)
    elif action is not None:
        for key in [k for k, v in data.items() if v.get("action") == action]:
            data.pop(key, None)
    _save(data)
