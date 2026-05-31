import os
import sqlite3
import uuid
import json

# DB_PATH is env-configurable so production can point at a persistent volume.
# On Railway: add a Volume mounted at /data and set DB_PATH=/data/writing_coach.db,
# otherwise the SQLite file lives on the ephemeral filesystem and is wiped on every redeploy.
DB_PATH = os.getenv("DB_PATH", "writing_coach.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn, table: str, column: str, ddl: str):
    """Add a column if an older DB file predates it (idempotent migration)."""
    cols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    # Make sure the parent directory of a volume-mounted DB exists.
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)

    conn = get_db()
    conn.executescript("""
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
            created_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS error_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            writing_session_id TEXT,
            error_type TEXT,
            count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    # Idempotent migration for DB files created before user_id existed.
    _ensure_column(conn, "writing_sessions", "user_id", "user_id TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_user ON writing_sessions(user_id, created_at)"
    )
    conn.commit()
    conn.close()


def create_session(exam_type: str, topic_text: str, user_id: str | None = None) -> str:
    session_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO writing_sessions (id, user_id, exam_type, topic_text) VALUES (?, ?, ?, ?)",
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
    conn.execute(f"UPDATE writing_sessions SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()


def get_session(session_id: str) -> dict | None:
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM writing_sessions WHERE id = ?", (session_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def save_error_records(session_id: str, error_summary: dict):
    conn = get_db()
    for error_type, count in error_summary.items():
        if count > 0:
            conn.execute(
                "INSERT INTO error_records (writing_session_id, error_type, count) VALUES (?, ?, ?)",
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
        """
        SELECT id, exam_type, topic_text, plan_position, correction_json, created_at, status
        FROM writing_sessions
        WHERE user_id = ? AND correction_json IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?
        """,
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
