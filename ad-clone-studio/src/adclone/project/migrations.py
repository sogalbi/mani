"""SQLite 스키마. PRAGMA user_version으로 버전을 관리한다."""

from __future__ import annotations

import sqlite3

from ..domain.errors import ProjectError

LATEST_VERSION = 1

_V1 = """
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    timeline_json TEXT NOT NULL,
    status TEXT NOT NULL,
    last_error TEXT,
    detect_params_json TEXT NOT NULL,
    next_shot_seq INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE reference_media (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    storage TEXT NOT NULL,
    original_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    video_info_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    detected_cuts_json TEXT,
    detected_at TEXT
);
CREATE TABLE shots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    ordinal INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    analysis_json TEXT NOT NULL DEFAULT '{}',
    edited_at TEXT
);
CREATE INDEX idx_shots_ordinal ON shots(project_id, ordinal);
"""

_MIGRATIONS = {1: _V1}


def migrate(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    if current > LATEST_VERSION:
        raise ProjectError(
            f"이 프로젝트는 더 새로운 버전의 앱에서 만들어졌습니다 (DB v{current}, 지원 v{LATEST_VERSION})"
        )
    for version in range(current + 1, LATEST_VERSION + 1):
        conn.executescript("BEGIN;\n" + _MIGRATIONS[version] + f"\nPRAGMA user_version = {version};\nCOMMIT;")
