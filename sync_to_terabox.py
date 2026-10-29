#!/usr/bin/env python3
"""PC-Agent <-> AList (Terabox) data pipeline."""

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
STATE_FILE = ROOT / "data" / "alist-sync.json"
LOCAL_LOG = ROOT / "data" / "sync.log"

DATA_SOURCES = ["data", "dataset", "training_data"]
ACTION_STORE = ROOT / "data" / "actions.json"
MODELS_DIR = ROOT / "models"
# যেকোনো লোকাল ফাইল যেগুলো ক্লাউডে যাবে না: API কী, টোকেন, প্রাইভেট কী, লগের ভেতরের তথ্য।
SKIP_NAMES = {"config.json", "access.json", "devices.json", "server.log", "updates.log",
              "alist-sync.json", "sync.log", ".env", "tasks.json"}
# widget-edge = Edge-এর ব্রাউজার প্রোফাইল (কুকি/এক্সটেনশন ডেটা), raw = কাঁচা ডেটাসেট
# ব্যাকগ্রাউন্ড — দুটোই ক্লাউডে যাবে না।
SKIP_DIRS = {"tls", "node_modules", "__pycache__", ".git", "widget-edge", "raw", "backups"}
MAX_FILE_BYTES = 64 * 1024 * 1024
REMOTE_SUBDIRS = ["training_data", "models", "logs"]


def load_env():
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env(name, default=None):
    value = os.environ.get(name)
    if value is None or value == "":
        if default is None:
            raise SystemExit(f".env-এ {name} নেই — দয়া করে বসান।")
        return default
    return value


class AListError(RuntimeError):
    pass


class AList:
    def __init__(self, url=None, token=None):
        self.url = (url or env("ALIST_URL", "http://localhost:5244")).rstrip("/")
        self.token = token if token is not None else env("ALIST_TOKEN", "")
        if not self.token:
            raise AListError("ALIST_TOKEN খালি — AList Manage -> Settings -> Token থেকে কপি করুন।")
        self.session = requests.Session()
        self.session.headers.update({"Authorization": self.token})

    def _call(self, path, payload=None, *, headers=None, data=None, params=None, timeout=120,
              method="POST"):
        resp = self.session.request(method, self.url + path, json=payload, headers=headers,
                                    data=data, params=params, timeout=timeout)
        if resp.status_code >= 400:
            raise AListError(f"{path} HTTP {resp.status_code}: {resp.text[:200]}")
        if "<!DOCTYPE html>" in resp.text[:200]:
            raise AListError(f"{path} {method} ম্যাচ করেনি — AList অ্যাপ পেজ ফেরত দিয়েছে")
        try:
            body = resp.json()
        except ValueError:
            raise AListError(f"{path} JSON দেয়নি: {resp.text[:200]}")
        if body.get("code") not in (200, None):
            raise AListError(f"{path} code {body.get('code')}: {body.get('message')}")
        return body.get("data") or {}

    def ping(self):
        resp = self.session.get(self.url + "/api/public/settings", timeout=20)
        if resp.status_code >= 400:
            raise AListError(f"ping HTTP {resp.status_code}")
        return resp.json().get("data") or {}

    def list(self, path, refresh=True):
        data = self._call("/api/fs/list", {"path": path, "page": 1, "per_page": 500,
                                           "refresh": refresh})
        return data.get("content") or []

    def mkdir(self, path):
        self._call("/api/fs/mkdir", {"path": path})

    def remove(self, path):
        parent = str(Path(path).parent).replace("\\", "/")
        self._call("/api/fs/remove", {"names": [Path(path).name], "dir": parent})

    def mkdir_p(self, path):
        built = ""
        for part in [p for p in path.split("/") if p]:
            built += "/" + part
            try:
                self.mkdir(built)
            except AListError:
                pass  # আগে থেকেই আছে

    def exists(self, path):
        parent = str(Path(path).parent).replace("\\", "/")
        name = Path(path).name
        if not parent:
            parent = "/"
        try:
            return any(item["name"] == name for item in self.list(parent))
        except AListError:
            return False

    def put(self, path, blob, tries=3):
        # Terabox ওভাররাইট করে না — নাম লেগে থাকলে সেটি রেখে ডুপ্লিকেট-নামের কপি বানায়,
        # তাই আগে সরিয়ে দিই। ডিলিট প্রোপাগেট হতে দেরি লাগে আর আপলোড মাঝে মাঝে
        # errno:1-এ ফেল করে, তাই backoff retry।
        had = self.exists(path)
        if had:
            self.remove(path)
        last = None
        for attempt in range(tries):
            if attempt:
                time.sleep(3 * attempt)
            elif had:
                time.sleep(1.5)
            try:
                self._call("/api/fs/put", data=blob, method="PUT", params=None,
                           headers={"File-Path": quote(path, safe=""),
                                    "Content-Type": "application/octet-stream",
                                    "Overwrite": "true"}, timeout=600)
                return
            except AListError as err:
                last = err
                logging.warning("আপলোড আবার চেষ্টা %s (%d/%d): %s", path, attempt + 1, tries, err)
        raise last

    def put_form(self, path, fileobj, name, tries=4):
        """বড় ফাইল স্ট্রিম করে পাঠানো হয়।

        এই AList বিল্ডে /api/fs/form রাউট নেই (SPA-র HTML ফেরত দেয়), তাই
        /api/fs/put-এর raw PUT-এই ফাইল-অবজেক্ট দিয়ে স্ট্রিম করা হয় —
        Content-Length দিতে হয়, নাহলে Terabox ড্রাইভার সাইজ জানে না।
        """
        last = None
        for attempt in range(tries):
            # Terabox বারবার বড় PUT দেখলে কয়েক মিনিটের জন্য throttle করে —
            # ৪ সেকেন্ডের ব্যাকঅফ তাই কিছুই ঠিক করত না
            if attempt:
                time.sleep(15 * attempt)
            fileobj.seek(0)
            try:
                resp = self.session.put(
                    self.url + "/api/fs/put",
                    data=fileobj,
                    headers={
                        "File-Path": quote(path, safe=""),
                        "Content-Type": "application/octet-stream",
                        "Overwrite": "true",
                        "As-Task": "false",
                    },
                    timeout=3600,
                )
                text = resp.text or ""
                if "<!DOCTYPE html>" in text[:200]:
                    raise AListError("AList PUT ম্যাচ করেনি (HTML ফেরত)")
                if resp.status_code >= 400:
                    raise AListError(f"stream HTTP {resp.status_code}: {text[:180]}")
                try:
                    body = resp.json()
                except ValueError:
                    raise AListError(f"JSON দেয়নি: {text[:180]}")
                if body.get("code") not in (200, None):
                    raise AListError(f"stream code {body.get('code')}: {body.get('message')}")
                return
            except (AListError, requests.RequestException) as err:
                last = err
                logging.warning("স্ট্রিম আপলোড আবার চেষ্টা %s (%d/%d): %s", path, attempt + 1, tries, err)
        raise last

    def upload_file(self, path, local: Path, *, as_name=None):
        size = local.stat().st_size
        # Terabox ওভাররাইট না করে ডুপ্লিকেট-নাম কপি বানায় — পুরনোটা সরিয়ে না দিলে
        # একই ফাইলের "name(1)" ভার্সন জমে যেত। লিস্টিং ভাঙলে exists() মিথ্যা False
        # দিত, তখন পুরনো ফাইল থেকেই যেত আর precreate-এ errno -6 দেখাত,
        # তাই head_size-ও বিকল্প হিসেবে দেখা হয়
        if self.head_size(path) >= 0 or self.exists(path):
            self.remove(path)
            for _ in range(5):
                if self.head_size(path) < 0 and not self.exists(path):
                    break
                time.sleep(3)
        with local.open("rb") as fh:
            self.put_form(path, fh, as_name or local.name)
        return size

    def head_size(self, path):
        try:
            data = self._call("/api/fs/get", {"path": path}, timeout=60)
        except AListError:
            return -1
        return int(data.get("size") or 0)

    def get_url(self, path):
        try:
            data = self._call("/api/fs/get", {"path": path}, timeout=60)
        except AListError:
            # মুছে আবার আপলোড করার পর AList-এর meta cache এক পাছ থাকে — তাজা list নিয়ে চেষ্টা
            self.list(str(Path(path).parent).replace("\\", "/"), refresh=True)
            data = self._call("/api/fs/get", {"path": path}, timeout=60)
        raw = data.get("raw_url")
        if not raw:
            raise AListError(f"{path} এর download URL নেই")
        return raw

    def download(self, path):
        resp = self.session.get(self.get_url(path), timeout=300)
        if resp.status_code >= 400:
            raise AListError(f"download {path} HTTP {resp.status_code}")
        return resp.content


def remote_root():
    return env("TERABOX_PATH", "/terabox/Ai/PC-Agent").rstrip("/")


def jrun(fn):
    def wrapped(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (AListError, requests.RequestException) as err:
            logging.error("ব্যর্থ: %s", err)
            raise
    return wrapped


def setup_logging():
    LOCAL_LOG.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(LOCAL_LOG, encoding="utf-8")],
        force=True,
    )


def iter_local_files():
    """যে লোকাল ফাইলগুলো training data হিসেবে যাবে (সিক্রেট বাদে)।"""
    for folder in DATA_SOURCES:
        base = ROOT / folder
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT).as_posix()
            parts = rel.split("/")
            if any(part in SKIP_DIRS for part in parts):
                continue
            if path.name in SKIP_NAMES or path.name.endswith(".log"):
                continue
            if path.stat().st_size > MAX_FILE_BYTES or path.stat().st_size == 0:
                continue
            yield rel, path


def local_key(rel, path):
    stat = path.stat()
    return f"{stat.st_size}:{int(stat.st_mtime)}"


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except ValueError:
            pass
    return {"uploaded": {}, "downloaded": {}}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def connect():
    client = AList()
    root = remote_root()
    try:
        client.ping()
    except (requests.RequestException, AListError) as err:
        raise SystemExit(
            f"AList ({client.url}) সাড়া দিচ্ছে না: {err}\n"
            " চালু করুন:  powershell -File scripts/start-alist.ps1"
        )
    logging.info("AList: %s root: %s", client.url, root)
    return client, root


@jrun
def cmd_init():
    client, root = connect()
    for folder in [root] + [f"{root}/{sub}" for sub in REMOTE_SUBDIRS]:
        client.mkdir_p(folder)
        logging.info("তৈরি/আছে: %s", folder)
    write_remote_config(client, root)
    push_log(client, root)
    return cmd_status(show_tree=True)


@jrun
def write_remote_config(client=None, root=None):
    client = client or AList()
    root = root or remote_root()
    training = f"{root}/training_data"
    try:
        count = len(list(walk(client, training)))
    except AListError:
        count = 0
    payload = {
        "storage": "terabox",
        "alist_path": root,
        "last_sync": int(time.time()),
        "data_count": count,
    }
    blob = (json.dumps(payload, indent=2) + "\n").encode("utf-8")
    client.put(f"{root}/config.json", blob)
    logging.info("remote config.json: data_count=%s", count)
    return payload


@jrun
def cmd_push():
    client, root = connect()
    state = load_state()
    uploaded = state["uploaded"]
    training = f"{root}/training_data"
    todo = []
    for rel, path in iter_local_files():
        if uploaded.get(rel) != local_key(rel, path):
            todo.append((rel, path))
    if not todo:
        logging.info("নতুন/বদলানো কোনো ডেটা নেই (%d ফাইল মিলে গেছে)", len(uploaded))
    for rel, path in todo:
        remote = f"{training}/{rel}"
        client.mkdir_p(str(Path(remote).parent).replace("\\", "/"))
        client.put(remote, path.read_bytes())
        uploaded[rel] = local_key(rel, path)
        logging.info("আপলোড %s (%d B)", rel, path.stat().st_size)
        save_state(state)
    if todo:
        save_state(state)
    if ACTION_STORE.exists():
        # agent সরাসরি এখান থেকে পড়ে: /terabox/Ai/PC-Agent/actions.json
        client.put(f"{root}/actions.json", ACTION_STORE.read_bytes())
        logging.info("অ্যাকশন-ডেটা মিরর হয়েছে: %s/actions.json", root)
    write_remote_config(client, root)
    push_log(client, root)
    return len(todo)


@jrun
def cmd_pull():
    client, root = connect()
    state = load_state()
    downloaded = state["downloaded"]
    moved = 0
    for item in walk(client, f"{root}/models"):
        rel = item["path"]
        local = MODELS_DIR / rel[len(f"{root}/models/"):].lstrip("/")
        key = f"{item['size']}"
        if downloaded.get(rel) == key and local.exists():
            continue
        if local.exists() and local.stat().st_size == item["size"]:
            downloaded[rel] = key
            continue
        local.parent.mkdir(parents=True, exist_ok=True)
        logging.info("ডাউনলোড %s (%d B)", rel, item["size"])
        local.write_bytes(client.download(rel))
        downloaded[rel] = key
        moved += 1
    save_state(state)
    if not moved:
        logging.info("models/ ফোল্ডারে নতুন কিছু ডাউনলোড করার নেই")
    push_log(client, root)
    return moved


def walk(client, path, depth=0):
    for item in client.list(path):
        child = f"{path}/{item['name']}"
        if item.get("is_dir"):
            if depth < 4:
                yield from walk(client, child, depth + 1)
        else:
            yield {"path": child, "size": int(item.get("size") or 0)}


CHUNK_MB = int(os.environ.get("MODEL_CHUNK_MB", "460"))
# Terabox পরপর বড় আপলোডে মাঝে মাঝে কয়েক মিনিটের throttle দেয় — খণ্ডের ফাঁকে বিরতি
PART_GAP_SEC = float(os.environ.get("MODEL_PART_GAP_SEC", "10"))
CHUNK_TMP = ROOT / "models" / "chunks"


def split_file(path: Path, chunk_bytes: int):
    """বড় ফাইলকে ক্রম-নামার খণ্ডে ভাঙে; Terabox একটি বড় ফাইল না নিলে খণ্ডগুলোই যাবে।

    ৮ MB ব্লকে কপি হয় — পুরো খণ্ড (৪৬০ MB) একবারতে মেমোরিতে নিলে এই মেশিন থ্রেশ করে।
    আগের রানে লেখা খণ্ড ফাইল ঠিক সাইজের থাকলে সেটাই reused হয়, প্রসেস মাঝপথে মরে গেলে
    আবার চালানোতে লোকাল ভাঙা-খণ্ড তৈরি হয় না।
    """
    CHUNK_TMP.mkdir(parents=True, exist_ok=True)
    total = path.stat().st_size
    parts = []
    n = 0
    offset = 0
    with path.open("rb") as fh:
        while offset < total:
            want = min(chunk_bytes, total - offset)
            p = CHUNK_TMP / f"{path.name}.part{n:03d}"
            if p.exists() and p.stat().st_size == want:
                parts.append(p)
            else:
                fh.seek(offset)
                left = want
                with p.open("wb") as out:
                    while left > 0:
                        blob = fh.read(min(8 << 20, left))
                        if not blob:
                            break
                        out.write(blob)
                        left -= len(blob)
                parts.append(p)
            offset += want
            n += 1
    return parts


@jrun
def cmd_push_models(dry=False, only=""):
    """models/*.gguf + manifest + কর্পাস Terabox-এ পাঠায় (খণ্ডসহ)।"""
    client, root = connect()
    # ভাঙা mount-এর উপর ১০ মিনিটের PUT চালানো বৃথা — লিস্টিং খালি এলে থামো
    try:
        if not client.list(root):
            raise AListError("লিস্টিং খালি")
    except AListError as err:
        raise AListError(
            f"Terabox লেন ঠিক নেই ({root} দেখা যাচ্ছে না: {err}) — "
            "AList রিস্টার্ট করুন, না হলে AList Manage -> Storages -> Terabox-এ নতুন cookie বসান"
        )
    state = load_state()
    uploaded = state.setdefault("models_uploaded", {})
    models_root = f"{root}/models"
    client.mkdir_p(models_root)
    client.mkdir_p(f"{models_root}/knowledge")
    client.mkdir_p(f"{models_root}/training")

    todo = []
    manifest = ROOT / "models" / "model-manifest.json"
    if manifest.exists():
        todo.append((manifest, f"{models_root}/model-manifest.json"))
    corpus_dir = ROOT / "data" / "knowledge"
    if corpus_dir.is_dir():
        for p in sorted(corpus_dir.glob("*.jsonl")):
            if p.stat().st_size:
                todo.append((p, f"{models_root}/knowledge/{p.name}"))
    # ট্রেন-সেটও ভাণ্ডারে থাকে — অন্য মেশিনে/পানিতে বসে Kaggle নোটবুক চালাতে পারবে
    train_dir = ROOT / "training" / "out"
    if train_dir.is_dir():
        for p in sorted(train_dir.glob("*.jsonl")):
            if p.stat().st_size:
                todo.append((p, f"{models_root}/training/{p.name}"))
    for p in sorted((ROOT / "models").glob("*.gguf")):
        todo.append((p, f"{models_root}/{p.name}"))
    if only:
        # "--only" ঠিক পথ, কোটা, স্পেস — সব আসতে পারে; নামের টুকরোটি না মিললে
        # ফিল্টার চুপচাপ সব ফেলে দিয়ে "কিছু নেই" বলত
        needle = str(only).replace("\\", "/").strip().rstrip("/").split("/")[-1]
        todo = [(l, r) for l, r in todo if needle in l.name]

    if not todo:
        logging.info("models/ বা কর্পাসে পাঠানোর কিছু নেই")
        return 0

    plan = []
    for local, remote in todo:
        size = local.stat().st_size
        key = f"{size}:{int(local.stat().st_mtime)}"
        if uploaded.get(remote) == key:
            continue
        plan.append((local, remote, size))
    if not plan:
        logging.info("মডেল/কর্পাস আগেই আপলোড করা আছে")
        return 0

    total = sum(s for _, _, s in plan)
    logging.info("আপলোড প্ল্যান: %d ফাইল, %.2f GB", len(plan), total / 1073741824)
    for local, remote, size in plan:
        logging.info("  %s -> %s (%.1f MB)", local.name, remote, size / 1048576)
    if dry:
        logging.info("(dry-run — কিছু পাঠানো হয়নি)")
        return len(plan)

    sent = 0
    for local, remote, size in plan:
        if size <= CHUNK_MB * 1024 * 1024:
            t0 = time.time()
            client.upload_file(remote, local)
            # Terabox-এর লিস্টিং আপডেট হতে কয়েক সেকেন্ড লাগে — একবার জিজ্ঞেস করলেই
            # সাইজ -1 এসে "মিলল না" বলে ফেলছিল, তাই ছোট বিরতিতে তিনবার দেখা হয়
            remote_size = -1
            for _ in range(3):
                remote_size = client.head_size(remote)
                if remote_size == size:
                    break
                time.sleep(4)
            if remote_size != size:
                logging.error("সাইজ মিলল না %s: লোকাল %d, রিমোট %s", remote, size, remote_size)
                continue
            uploaded[remote] = f"{size}:{int(local.stat().st_mtime)}"
            logging.info("আপলোড %s (%.1f MB, %.0f সেকেন্ড, %.2f MB/s)",
                         remote, size / 1048576, time.time() - t0, size / 1048576 / max(1, time.time() - t0))
        else:
            parts = split_file(local, CHUNK_MB * 1024 * 1024)
            names = []
            failed = []
            for p in parts:
                # স্থানীয় নাম "qwen….gguf.part003" -> দূরবর্তী নামও সেই একই প্রত্যয়
                r = f"{remote}.part{p.name.rsplit('.part', 1)[-1]}"
                names.append(r)
                # আপলোডার মাঝপথে মরে গেলে আগের খণ্ডগুলো আবার না পাঠিয়ে রিমোট সাইজ মিলিয়ে দেখা হয়
                if client.head_size(r) == p.stat().st_size:
                    p.unlink()
                    logging.info("খণ্ড আগেই আছে %s — বাদ গেল", r)
                    continue
                try:
                    client.upload_file(r, p)   # ভাঙা খণ্ড থাকলে upload_file আগে সরিয়ে দেয়
                    p.unlink()
                    logging.info("খণ্ড আপলোড %s", r)
                except (AListError, requests.RequestException) as err:
                    # একটি খণ্ডের ব্যর্থতায় পুরো রান মারবে না — অন্য ফাইলের খণ্ডগুলো
                    # তবু পাঠানো যাবে, আর স্থানীয় খণ্ডটি মুছে যাবে না তাই পরেরবার থেকে চলবে
                    failed.append(r)
                    logging.error("খণ্ড ব্যর্থ %s: %s", r, err)
                time.sleep(PART_GAP_SEC)
            if failed:
                logging.error("%s অসম্পূর্ণ: %d/%d খণ্ড যায়নি — আবার চালালে বাকিগুলো যাবে",
                              local.name, len(failed), len(names))
                continue
            uploaded[remote] = f"{size}:{int(local.stat().st_mtime)}:chunked={len(names)}"
            logging.info("খণ্ডে পাঠানো হলো %s (%d খণ্ড)", remote, len(names))
        save_state(state)
        sent += 1

    # খণ্ড গাঁথার স্ক্রিপ্টও রাখা হয় — অন্য মেশিন থেকে নামিয়ে জোড়া দেওয়া যাবে
    merge = f"""#!/usr/bin/env python3
\"\"\"Terabox থেকে নামানো খণ্ড জোড়া দিয়ে আসল ফাইল বানায়। ব্যবহার: python merge-models.py <name.gguf>\"\"\"
import sys
from pathlib import Path

name = sys.argv[1]
parts = sorted(Path('.').glob(f"{{name}}.part*"))
out = Path(name)
with out.open("wb") as fh:
    for p in parts:
        fh.write(p.read_bytes())
        p.unlink()
print(f"{{out}} গাঁথা হলো ({{len(parts)}} খণ্ড)")
"""
    client.put(f"{models_root}/merge-models.py", merge.encode("utf-8"))
    push_log(client, root)
    return sent


@jrun
def cmd_status(show_tree=False):
    client, root = connect()
    out = {"url": client.url, "root": root}
    for sub in [""] + REMOTE_SUBDIRS:
        path = f"{root}/{sub}".rstrip("/")
        try:
            items = client.list(path)
            out[path] = {"files": len(items), "bytes": sum(int(i.get("size") or 0) for i in items)}
            if show_tree:
                for i in items:
                    logging.info("%s%s %s", path + "/", "D " if i.get("is_dir") else "F ", i["name"])
        except AListError as err:
            out[path] = {"error": str(err)}
    logging.info(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def push_log(client, root):
    if not LOCAL_LOG.exists():
        return
    blob = LOCAL_LOG.read_bytes()[-400_000:]
    client.put(f"{root}/logs/sync.log", blob)
    logging.info("লগ পাঠানো হয়েছে: %s/logs/sync.log", root)


@jrun
def cmd_sync():
    pushed = cmd_push()
    pulled = cmd_pull()
    logging.info("sync শেষ: %d আপলোড, %d ডাউনলোড", pushed, pulled)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    load_env()
    setup_logging()
    parser = argparse.ArgumentParser(description="PC-Agent <-> AList (Terabox) sync")
    parser.add_argument("command", nargs="?", default="sync",
                        choices=["init", "push", "pull", "push-models", "status", "sync"])
    parser.add_argument("--dry", action="store_true", help="কী পাঠানোর কথা তাই দেখাও, পাঠিও না")
    parser.add_argument("--only", default="", help="নামে এই লেখা থাকা ফাইলটাই পাঠাও")
    args = parser.parse_args(argv)
    if args.command == "push-models":
        cmd_push_models(dry=args.dry, only=args.only)
        return
    {"init": cmd_init, "push": cmd_push, "pull": cmd_pull,
     "status": cmd_status, "sync": cmd_sync}[args.command]()


if __name__ == "__main__":
    main()
