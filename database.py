import sqlite3
import uuid
import json

DB_PATH = "writing_coach.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS writing_sessions (
            id TEXT PRIMARY KEY,
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
    conn.commit()
    conn.close()


def create_session(exam_type: str, topic_text: str) -> str:
    session_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO writing_sessions (id, exam_type, topic_text) VALUES (?, ?, ?)",
        (session_id, exam_type, topic_text),
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
