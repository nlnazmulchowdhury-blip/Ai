"""
Mother Agent (HR).

Dynamically creates new agents from a user prompt. create_new_agent()
writes a ready-to-import python file into bosses/ or workers/, then
records the hire in long_term_memory.json so the company remembers it.

Role inference: words like boss/manage/team -> boss, otherwise worker.
The CEO (super_boss) re-scans the directories after creation, so the
new agent is picked up on the very next task.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOSSES_DIR = ROOT / "bosses"
WORKERS_DIR = ROOT / "workers"
MEMORY_FILE = ROOT / "memory" / "long_term_memory.json"

# Literal braces in the generated code are doubled for str.format().
BOSS_TEMPLATE = '''"""Auto-created by the Mother Agent. {description}"""
from bosses.base_boss import BaseBoss
from workers.api_fetcher_worker import ApiFetcherWorker


class {class_name}(BaseBoss):
    name = "{agent_name}"
    workers = {{"{keyword}": ApiFetcherWorker}}

    def handle(self, task):
        return "{description}"
'''

WORKER_TEMPLATE = '''"""Auto-created by the Mother Agent. {description}"""
from workers.base_worker import BaseWorker, WorkerError


class {class_name}(BaseWorker):
    name = "{agent_name}"

    async def do_task(self, task):
        # TODO: implement the real work here; this skeleton raises so the
        # boss escalates instead of silently pretending success.
        raise WorkerError(
            "{agent_name} is a skeleton created by the Mother Agent - "
            "implement do_task(). Task: {{task!r}}"
        )
'''


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "task"
    return slug[:28]


def _role_from(text: str) -> str:
    if re.search(r"\b(boss|manage|supervise|team|head|lead)\b", text, re.I):
        return "boss"
    return "worker"


def create_new_agent(role: str, description: str) -> dict:
    """Create a new agent file and register it in long-term memory.

    Returns {"name", "role", "file"}. Raises FileExistsError if the
    same agent already exists, ValueError for a bad role.
    """
    role = role.lower()
    if role not in ("boss", "worker"):
        raise ValueError("role must be 'boss' or 'worker'")

    slug = _slug(description)
    agent_name = slug if slug.endswith(f"_{role}") else f"{slug}_{role}"
    class_name = "".join(part.capitalize() for part in slug.split("_"))
    class_name += "Boss" if role == "boss" else "Worker"

    target_dir = BOSSES_DIR if role == "boss" else WORKERS_DIR
    file_path = target_dir / f"{agent_name}.py"
    if file_path.exists():
        raise FileExistsError(f"agent already exists: {file_path}")

    template = BOSS_TEMPLATE if role == "boss" else WORKER_TEMPLATE
    code = template.format(
        agent_name=agent_name,
        class_name=class_name,
        description=description,
        keyword=slug.split("_")[0],
    )
    file_path.write_text(code, encoding="utf-8")

    # Record the hire in long-term memory.
    memory = {}
    if MEMORY_FILE.exists():
        try:
            memory = json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            memory = {}
    memory.setdefault("agents", []).append(
        {
            "name": agent_name,
            "role": role,
            "file": str(file_path.relative_to(ROOT)),
            "description": description,
            "created_by": "mother_agent",
        }
    )
    MEMORY_FILE.write_text(
        json.dumps(memory, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"name": agent_name, "role": role, "file": str(file_path)}


async def create_agent_for_task(task: dict) -> dict:
    """CEO entry point: infer role/description from the task prompt."""
    text = " ".join(
        str(task.get(key) or "") for key in ("action", "prompt", "content")
    )
    role = _role_from(text)
    description = (text.strip().splitlines() or [""])[0][:120] or "general task"
    try:
        return create_new_agent(role, description)
    except FileExistsError:
        slug = _slug(description)
        return {"name": f"{slug}_{role}", "role": role, "exists": True}
