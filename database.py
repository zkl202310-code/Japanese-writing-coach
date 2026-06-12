import os
import sqlite3
import uuid
import json

# Two backends, picked at import time:
# - DATABASE_URL set (postgres://...) -> external Postgres (e.g. Neon free tier).
#   This is the fix for ephemeral filesystems: Render's free tier wipes the
#   local SQLite file on every redeploy, resetting all learning history.
# - otherwise -> local SQLite file, so local dev stays zero-config.
# Sanitize the URL: values pasted from line-wrapped terminal output can carry
# stray newlines/spaces mid-string (and sometimes wrapping quotes). A URL never
# legitimately contains whitespace, so collapsing it reconstructs the original.
DATABASE_URL = "".join(os.getenv("DATABASE_URL", "").split()).strip("'\"")
IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))

if IS_PG:
    import psycopg
    from psycopg.rows import dict_row

# DB_PATH is env-configurable so a platform with a persistent volume can point
# the SQLite file at it (e.g. DB_PATH=/data/writing_coach.db). Ignored when
# DATABASE_URL is set.
DB_PATH = os.getenv("DB_PATH", "writing_coach.db")


def get_db():
    if IS_PG:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def q(sql: str) -> str:
    """All queries below are written in SQLite paramstyle (?); Postgres wants %s."""
    return sql.replace("?", "%s") if IS_PG else sql


def _ensure_column(conn, table: str, column: str, ddl: str):
    """Add a column if an older SQLite DB file predates it (idempotent migration)."""
    cols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    if IS_PG:
        autoinc_id = "BIGSERIAL PRIMARY KEY"
        # Match SQLite's datetime('now') text format so ORDER BY and the
        # frontend's date slicing behave identically on both backends.
        now_text = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"
    else:
        # Make sure the parent directory of a volume-mounted DB exists.
        parent = os.path.dirname(DB_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        autoinc_id = "INTEGER PRIMARY KEY AUTOINCREMENT"
        now_text = "datetime('now')"

    statements = [
        f"""
        CREATE TABLE IF NOT EXISTS writing_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            exam_type TEXT NOT NULL,
            topic_text TEXT,
            plan_position TEXT,
            plan_reasons TEXT,
            plan_structure TEXT,
            plan_feedback TEXT,
            draft_original TEXT,
            socratic_questions TEXT,
            correction_json TEXT,
            reflection_json TEXT,
            model_essay_json TEXT,
            status TEXT DEFAULT 'plan',
            created_at TEXT DEFAULT ({now_text}),
            completed_at TEXT
        )""",
        f"""
        CREATE TABLE IF NOT EXISTS error_records (
            id {autoinc_id},
            writing_session_id TEXT,
            error_type TEXT,
            count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT ({now_text})
        )""",
        f"""
        CREATE TABLE IF NOT EXISTS email_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            scene_id TEXT NOT NULL,
            scene_title TEXT,
            scene_category TEXT DEFAULT 'academic',
            key_info TEXT,
            email_draft TEXT,
            correction_json TEXT,
            created_at TEXT DEFAULT ({now_text})
        )""",
        "CREATE INDEX IF NOT EXISTS idx_sessions_user ON writing_sessions(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_email_sessions_user ON email_sessions(user_id, created_at)",
    ]

    conn = get_db()
    for stmt in statements:
        conn.execute(stmt)
    if not IS_PG:
        # Idempotent migration for SQLite DB files created before user_id existed.
        _ensure_column(conn, "writing_sessions", "user_id", "user_id TEXT")
    conn.commit()
    conn.close()


def create_session(exam_type: str, topic_text: str, user_id: str | None = None) -> str:
    session_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        q("INSERT INTO writing_sessions (id, user_id, exam_type, topic_text) VALUES (?, ?, ?, ?)"),
        (session_id, user_id, exam_type, topic_text),
    )
    conn.commit()
    conn.close()
    return session_id


def update_session(session_id: str, **kwargs):
    if not kwargs:
        return
    set_clause = ", ".join(f"{k} = ?" for k in kwargs)
    values = list(kwargs.values()) + [session_id]
    conn = get_db()
    conn.execute(q(f"UPDATE writing_sessions SET {set_clause} WHERE id = ?"), values)
    conn.commit()
    conn.close()


def get_session(session_id: str) -> dict | None:
    conn = get_db()
    row = conn.execute(
        q("SELECT * FROM writing_sessions WHERE id = ?"), (session_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def save_error_records(session_id: str, error_summary: dict):
    conn = get_db()
    for error_type, count in error_summary.items():
        if count > 0:
            conn.execute(
                q("INSERT INTO error_records (writing_session_id, error_type, count) VALUES (?, ?, ?)"),
                (session_id, error_type, count),
            )
    conn.commit()
    conn.close()


# ---- Learning history / trend analytics ----

ERROR_TYPES = ["particle", "register", "conjugation", "connector", "naturalness", "grammar"]


def get_user_history(user_id: str, limit: int = 30) -> list[dict]:
    """Return the user's completed/corrected sessions, newest first, with parsed summaries."""
    conn = get_db()
    rows = conn.execute(
        q("""
        SELECT id, exam_type, topic_text, plan_position, correction_json, created_at, status
        FROM writing_sessions
        WHERE user_id = ? AND correction_json IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?
        """),
        (user_id, limit),
    ).fetchall()
    conn.close()

    history = []
    for row in rows:
        try:
            corr = json.loads(row["correction_json"])
        except (json.JSONDecodeError, TypeError):
            corr = {}
        summary = corr.get("error_summary", {}) or {}
        history.append({
            "session_id": row["id"],
            "exam_type": row["exam_type"],
            "topic_text": row["topic_text"],
            "position": row["plan_position"],
            "created_at": row["created_at"],
            "status": row["status"],
            "score_level": (corr.get("score_estimate") or {}).get("level", "—"),
            "error_summary": {t: int(summary.get(t, 0) or 0) for t in ERROR_TYPES},
            "total_errors": sum(int(v or 0) for v in summary.values()),
        })
    return history


def get_user_stats(user_id: str) -> dict:
    """Aggregate counts across all of a user's sessions for the dashboard."""
    history = get_user_history(user_id, limit=1000)
    totals = {t: 0 for t in ERROR_TYPES}
    for h in history:
        for t in ERROR_TYPES:
            totals[t] += h["error_summary"].get(t, 0)

    # Weakest type = the error category the user makes most.
    weakest = max(totals, key=totals.get) if any(totals.values()) else None
    return {
        "total_sessions": len(history),
        "total_errors": sum(totals.values()),
        "error_totals": totals,
        "weakest_type": weakest,
        # Oldest-first error-per-essay series for the trend line.
        "trend": [
            {"created_at": h["created_at"], "total_errors": h["total_errors"], "exam_type": h["exam_type"]}
            for h in reversed(history)
        ],
    }


# ---- Track 2: email session history ----

EMAIL_SCORE_DIMS = ["keigo", "politeness", "format", "naturalness"]


def _num(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def save_email_session(
    user_id: str | None,
    scene_id: str,
    scene_title: str,
    scene_category: str,
    key_info: str,
    email_draft: str,
    correction_json: str,
) -> str:
    session_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        q("""INSERT INTO email_sessions
           (id, user_id, scene_id, scene_title, scene_category, key_info, email_draft, correction_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"""),
        (session_id, user_id, scene_id, scene_title, scene_category, key_info, email_draft, correction_json),
    )
    conn.commit()
    conn.close()
    return session_id


def get_email_history(user_id: str, limit: int = 30) -> list[dict]:
    """Return the user's corrected emails, newest first, with parsed scores."""
    conn = get_db()
    rows = conn.execute(
        q("""
        SELECT id, scene_id, scene_title, scene_category, email_draft, correction_json, created_at
        FROM email_sessions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """),
        (user_id, limit),
    ).fetchall()
    conn.close()

    history = []
    for row in rows:
        try:
            corr = json.loads(row["correction_json"])
        except (json.JSONDecodeError, TypeError):
            corr = {}
        score = corr.get("score", {}) or {}
        draft = row["email_draft"] or ""
        history.append({
            "session_id": row["id"],
            "scene_id": row["scene_id"],
            "scene_title": row["scene_title"],
            "scene_category": row["scene_category"] or "academic",
            "created_at": row["created_at"],
            "grade": score.get("grade") or "—",
            "total": _num(score.get("total")),
            "dims": {d: _num(score.get(d)) for d in EMAIL_SCORE_DIMS},
            "keigo_mistakes": len(corr.get("keigo_mistakes") or []),
            "draft_preview": draft[:60],
        })
    return history


def get_email_stats(user_id: str) -> dict:
    """Aggregate email scores for the dashboard (higher = better, unlike essay errors)."""
    history = get_email_history(user_id, limit=1000)
    n = len(history)
    dim_avgs = {
        d: round(sum(h["dims"][d] for h in history) / n, 1) if n else 0
        for d in EMAIL_SCORE_DIMS
    }
    weakest = min(dim_avgs, key=dim_avgs.get) if n else None
    return {
        "total_sessions": n,
        "avg_total": round(sum(h["total"] for h in history) / n, 1) if n else 0,
        "dim_avgs": dim_avgs,
        "weakest_dim": weakest,
        # Oldest-first total-score series for the trend chart.
        "trend": [
            {"created_at": h["created_at"], "total": h["total"], "grade": h["grade"]}
            for h in reversed(history)
        ],
    }
