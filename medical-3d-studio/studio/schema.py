"""Schema validation of every data file (python -m studio validate)."""
import json

from jsonschema import Draft202012Validator

from .data import load_json, load_yaml


def _schema(root, name):
    return Draft202012Validator(json.loads((root / "schemas" / f"{name}.schema.json").read_text(encoding="utf-8")))


def _check(root, name, data, label, errors):
    for e in _schema(root, name).iter_errors(data):
        path = "/".join(str(p) for p in e.absolute_path)
        errors.append(f"{label}: {path or '(root)'} – {e.message}")


def validate_all(studio):
    r = studio.root
    errors = []
    _check(r, "sources", load_yaml(r / "research/sources.yaml", {}), "research/sources.yaml", errors)
    _check(r, "assets", load_yaml(r / "assets/registry.yaml", {}), "assets/registry.yaml", errors)
    _check(r, "reviewers", load_yaml(r / "config/reviewers.yaml", {}), "config/reviewers.yaml", errors)
    _check(r, "videos", load_yaml(r / "publishing/videos.yaml", {"videos": []}), "publishing/videos.yaml", errors)
    _check(r, "corrections", load_yaml(r / "analytics/corrections.yaml", {"tickets": []}), "analytics/corrections.yaml", errors)
    for d in studio.topic_dirs():
        _check(r, "topic", load_yaml(d / "topic.yaml", {}), f"{d.name}/topic.yaml", errors)
        _check(r, "claims", load_yaml(d / "claims.yaml", {}), f"{d.name}/claims.yaml", errors)
        _check(r, "script", load_yaml(d / "script.yaml", {}), f"{d.name}/script.yaml", errors)
        if (d / "shots.json").exists():
            _check(r, "shots", load_json(d / "shots.json"), f"{d.name}/shots.json", errors)
        pub = r / "publishing" / f"{d.name}.yaml"
        if pub.exists():
            _check(r, "publishing", load_yaml(pub, {}), f"publishing/{d.name}.yaml", errors)
        for k in ("medical", "legal_policy"):
            p = r / "reviews" / k / f"{d.name}.yaml"
            if p.exists():
                _check(r, "approvals", load_yaml(p, {}), f"reviews/{k}/{d.name}.yaml", errors)
    return errors
