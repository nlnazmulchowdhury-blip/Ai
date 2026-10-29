"""
JSON extraction & fixing utilities.

Every agent that talks to a web AI MUST route the raw reply through
extract_json(). It handles:

  * markdown fences (```json ... ```) and prose around the object
  * Windows-style backslash paths inside strings (C:\\Users\\...)
  * markdown-escaped characters (\\_, \\*, \\[) which break JSON.parse
  * trailing commas and single-quoted strings via a small repair pass

Retry flow: callers catch FixerError, append the retry hint carried by
the exception to the prompt, and ask the provider again
(see api_fetcher_worker and base_boss for the loop).
"""
from __future__ import annotations

import json
import re


class FixerError(Exception):
    """Raised when no JSON object could be extracted or repaired."""

    retry_hint = (
        "Your previous reply was not valid JSON. "
        "Reply again with ONLY a valid JSON object, no markdown fences."
    )


def _strip_markdown_escapes(text: str) -> str:
    """Remove backslashes that escape characters which are not valid JSON escapes."""
    return re.sub(r"\\(?![\\\"/bfnrtu])", "", text)


def _fix_windows_paths(text: str) -> str:
    """Double invalid backslashes inside quoted strings so paths survive JSON parsing.

    Web AIs write Windows paths like C:\\Users\\x with single backslashes,
    which is invalid JSON. This string-aware pass doubles every backslash
    that is not a real JSON escape (\\", \\\\, \\/, \\uXXXX), so
    C:\\Users\\nlnaz becomes C:\\\\Users\\\\nlnaz in the raw text.
    """
    out = []
    i, n = 0, len(text)
    in_str = False
    while i < n:
        ch = text[i]
        if not in_str:
            out.append(ch)
            if ch == '"':
                in_str = True
            i += 1
            continue
        if ch == '"':
            out.append(ch)
            in_str = False
            i += 1
            continue
        if ch == "\\":
            nxt = text[i + 1] if i + 1 < n else ""
            if nxt in ('"', "\\", "/"):
                out.append(ch + nxt)
                i += 2
                continue
            if nxt == "u" and i + 5 < n and all(
                c in "0123456789abcdefABCDEF" for c in text[i + 2 : i + 6]
            ):
                out.append(text[i : i + 6])
                i += 6
                continue
            out.append("\\\\")  # not a JSON escape -> make it a literal backslash
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _repair(text: str) -> str:
    """Best-effort repair: trailing commas, single-quoted strings."""
    repaired = re.sub(r",\s*([}\]])", r"\1", text)
    repaired = re.sub(r"'([^'\"]*)'", r'"\1"', repaired)
    return repaired


def _candidates(text: str):
    """Yield the fenced JSON block (if any) first, then the raw text."""
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S | re.I)
    if fence:
        yield fence.group(1)
    yield text


def _first_json_object(text: str):
    """Find the first balanced {...} region, respecting strings and escapes."""
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        start = text.find("{", start + 1)
    return None


def _parse_attempts(slice_text: str):
    """Yield progressively repaired variants of the candidate object."""
    attempts = [
        slice_text,
        _fix_windows_paths(slice_text),
        _strip_markdown_escapes(slice_text),
        _strip_markdown_escapes(_fix_windows_paths(slice_text)),
        _repair(slice_text),
        _repair(_strip_markdown_escapes(_fix_windows_paths(slice_text))),
    ]
    seen = set()
    for attempt in attempts:
        if attempt in seen:
            continue
        seen.add(attempt)
        yield attempt


def extract_json(text: str) -> dict:
    """Return the first parseable JSON object found in `text`.

    Raises FixerError when nothing valid can be extracted.
    """
    for candidate in _candidates(text or ""):
        obj_text = _first_json_object(candidate)
        if obj_text is None:
            continue
        for attempt in _parse_attempts(obj_text):
            try:
                parsed = json.loads(attempt)
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(parsed, dict):
                return parsed
    raise FixerError("No valid JSON object found in provider reply")


def salvage(text: str):
    """Last-resort regex salvage of envelope keys (say/next/final)."""
    def _grab(key: str):
        match = re.search(rf'"{key}"\s*:\s*"([^"]*)"', text or "")
        return match.group(1) if match else None

    say = _grab("say")
    next_ = _grab("next")
    final = bool(re.search(r'"final"\s*:\s*true', text or "", re.I))
    if say is None and next_ is None and not final:
        return None
    return {"say": say or "", "next": next_, "final": final, "salvaged": True}
