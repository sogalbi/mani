"""Loading the studio's files: config, topic packages, registries, review logs."""
import datetime as _dt
import hashlib
import json
import os
from pathlib import Path

import yaml

ROOT = Path(os.environ.get("M3D_ROOT", Path(__file__).resolve().parent.parent))

GATES = ["G0", "G1", "G2", "G3", "G4", "G5"]
DECISIONS = ["PASS", "REVISE", "BLOCK", "UNKNOWN"]


def now_iso():
    return _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def today():
    return _dt.date.today().isoformat()


def load_yaml(path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return default if data is None else data


def dump_yaml(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, width=100)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def canonical_hash(obj, n=12):
    blob = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:n]


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_hash(folder, pattern="*.py"):
    """Hash of every matching file below folder (path + content)."""
    h = hashlib.sha256()
    for p in sorted(Path(folder).rglob(pattern)):
        if "__pycache__" in p.parts:
            continue
        h.update(str(p.relative_to(folder)).encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


class Studio:
    """Everything the CLI needs, loaded from ROOT."""

    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.channel = load_yaml(self.root / "config/channel.yaml", {})
        self.style = load_yaml(self.root / "config/style.yaml", {})
        self.policy = load_yaml(self.root / "config/policy.yaml", {})
        self.reviewers = load_yaml(self.root / "config/reviewers.yaml", {}).get("reviewers", []) or []
        self.sources = {s["source_id"]: s for s in (load_yaml(self.root / "research/sources.yaml", {}).get("sources") or [])}
        self.policy_refs = load_yaml(self.root / "research/policy_refs.yaml", {}) or {}
        self.assets = {a["asset_id"]: a for a in (load_yaml(self.root / "assets/registry.yaml", {}).get("assets") or [])}

    # topics -------------------------------------------------------------
    def topic_dirs(self):
        return sorted(p for p in (self.root / "topics").iterdir() if p.is_dir() and (p / "topic.yaml").exists())

    def topic(self, topic_id):
        for d in self.topic_dirs():
            if d.name == topic_id or d.name.startswith(topic_id + "_"):
                return Topic(self, d)
        raise SystemExit(f"주제를 찾을 수 없어요: {topic_id} (topics/ 아래 폴더 이름 확인)")

    def reviewer(self, reviewer_id):
        for r in self.reviewers:
            if r.get("reviewer_id") == reviewer_id:
                return r
        return None


class Topic:
    def __init__(self, studio, path):
        self.studio = studio
        self.dir = Path(path)
        self.meta = load_yaml(self.dir / "topic.yaml", {})
        self.id = self.meta.get("topic_id", self.dir.name.split("_")[0])
        self.slug = self.dir.name
        self.claims = load_yaml(self.dir / "claims.yaml", {}).get("claims", []) or []
        self.script = load_yaml(self.dir / "script.yaml", {}) or {}
        self.shots_doc = load_json(self.dir / "shots.json") if (self.dir / "shots.json").exists() else {}
        self.shots = self.shots_doc.get("shots", [])
        self.publishing = load_yaml(studio.root / "publishing" / f"{self.slug}.yaml", {}) or {}

    @property
    def claim_map(self):
        return {c["claim_id"]: c for c in self.claims}

    def lines(self):
        return self.script.get("lines", []) or []

    def review_log_paths(self):
        r = self.studio.root / "reviews"
        return {"medical": r / "medical" / f"{self.slug}.yaml", "legal_policy": r / "legal_policy" / f"{self.slug}.yaml"}

    def approvals(self):
        out = []
        for kind, p in self.review_log_paths().items():
            for rec in (load_yaml(p, {}) or {}).get("records", []) or []:
                out.append(dict(rec, _log=kind))
        return sorted(out, key=lambda r: r.get("timestamp", ""))

    def manifests(self, quality):
        folder = self.studio.root / "renders" / quality
        return sorted(folder.glob(f"{self.id}_v*.manifest.json"))

    def latest_manifest(self, quality):
        ms = self.manifests(quality)
        return load_json(ms[-1]) if ms else None

    def corrections(self):
        data = load_yaml(self.studio.root / "analytics/corrections.yaml", {}) or {}
        return [t for t in data.get("tickets", []) or [] if t.get("topic_id") == self.id]
