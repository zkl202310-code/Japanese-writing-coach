import json
import random
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import data_loader
import prompts
from database import (
    create_session,
    get_session,
    get_user_history,
    get_user_stats,
    init_db,
    save_error_records,
    update_session,
)
from llm_client import chat, chat_json


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="JWriteCoach", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


# ---- Request models ----

class PlanRequest(BaseModel):
    exam_type: str
    topic_text: str
    position: str
    reasons: list[str]
    structure: str
    user_id: str | None = None


class DraftRequest(BaseModel):
    session_id: str
    draft: str


class SessionRequest(BaseModel):
    session_id: str


# ---- Helpers ----

def safe_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group())
        raise ValueError("LLM returned invalid JSON")


def fmt_reasons(reasons: list[str]) -> str:
    return "、".join(r for r in reasons if r.strip()) or "（未填写）"


# ---- Routes ----

@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/api/topic")
async def get_topic(exam_type: str):
    topics = data_loader.get_topics(exam_type)
    if not topics:
        raise HTTPException(status_code=404, detail="No topics for this exam type")
    topic = random.choice(topics)
    return topic


@app.post("/api/plan/review")
async def review_plan(req: PlanRequest):
    exam_label = prompts.EXAM_LABELS.get(req.exam_type, req.exam_type)

    def r(i):
        return req.reasons[i] if len(req.reasons) > i and req.reasons[i].strip() else "（未填写）"

    feedback = chat(
        system=prompts.PLAN_REVIEW_SYSTEM,
        user=prompts.PLAN_REVIEW_USER.format(
            exam_label=exam_label,
            topic=req.topic_text,
            position=req.position,
            reason1=r(0),
            reason2=r(1),
            reason3=r(2),
            structure=req.structure,
        ),
        temperature=0.5,
    )

    session_id = create_session(req.exam_type, req.topic_text, user_id=req.user_id)
    update_session(
        session_id,
        plan_position=req.position,
        plan_reasons=json.dumps(req.reasons, ensure_ascii=False),
        plan_structure=req.structure,
        plan_feedback=feedback,
        status="writing",
    )

    # The prompt always ends with either 【可以开始写作】 or 【建议先调整计划】.
    # Treat "needs adjustment" as the only blocking signal; default to proceed otherwise.
    can_proceed = "【建议先调整计划】" not in feedback

    return {"session_id": session_id, "feedback": feedback, "can_proceed": can_proceed}


MIN_DRAFT_LEN = 50


@app.post("/api/draft/socratic")
async def get_socratic(req: DraftRequest):
    if len(req.draft.strip()) < MIN_DRAFT_LEN:
        raise HTTPException(status_code=400, detail=f"作文内容太短，请至少写 {MIN_DRAFT_LEN} 字后再提交（当前 {len(req.draft.strip())} 字）")
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    exam_label = prompts.EXAM_LABELS.get(session["exam_type"], session["exam_type"])
    reasons = json.loads(session["plan_reasons"])

    questions = chat(
        system=prompts.SOCRATIC_SYSTEM,
        user=prompts.SOCRATIC_USER.format(
            exam_label=exam_label,
            topic=session["topic_text"],
            position=session["plan_position"],
            reasons=fmt_reasons(reasons),
            draft=req.draft,
        ),
        temperature=0.6,
    )

    update_session(req.session_id, draft_original=req.draft, socratic_questions=questions, status="reviewing")
    return {"questions": questions}


@app.post("/api/draft/correct")
async def correct_draft(req: DraftRequest):
    if len(req.draft.strip()) < MIN_DRAFT_LEN:
        raise HTTPException(status_code=400, detail=f"作文内容太短，请至少写 {MIN_DRAFT_LEN} 字后再提交")
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    exam_label = prompts.EXAM_LABELS.get(session["exam_type"], session["exam_type"])
    reasons = json.loads(session["plan_reasons"])

    result_str = chat_json(
        system=prompts.CORRECTION_SYSTEM.format(
            position=session["plan_position"],
            reasons=fmt_reasons(reasons),
        ),
        user=prompts.CORRECTION_USER.format(
            exam_label=exam_label,
            topic=session["topic_text"],
            structure=session["plan_structure"],
            draft=req.draft,
        ),
    )

    result = safe_json(result_str)
    update_session(req.session_id, correction_json=result_str, status="reflecting")
    save_error_records(req.session_id, result.get("error_summary", {}))
    return result


@app.post("/api/reflection")
async def get_reflection(req: SessionRequest):
    session = get_session(req.session_id)
    if not session or not session["correction_json"]:
        raise HTTPException(status_code=400, detail="Correction not available yet")

    correction = safe_json(session["correction_json"])

    result_str = chat_json(
        system=prompts.REFLECTION_SYSTEM,
        user=prompts.REFLECTION_USER.format(
            original=session["draft_original"] or "",
            corrected=correction.get("corrected_essay", ""),
            error_summary=json.dumps(correction.get("error_summary", {}), ensure_ascii=False),
            annotations_count=len(correction.get("annotations", [])),
        ),
    )

    result = safe_json(result_str)
    update_session(req.session_id, reflection_json=result_str, status="complete")
    return result


@app.post("/api/model-essay")
async def get_model_essay(req: SessionRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    exam_label = prompts.EXAM_LABELS.get(session["exam_type"], session["exam_type"])
    reasons = json.loads(session["plan_reasons"])

    result_str = chat_json(
        system=prompts.MODEL_ESSAY_SYSTEM.format(
            position=session["plan_position"],
            reasons=fmt_reasons(reasons),
            exam_label=exam_label,
            structure=session["plan_structure"],
        ),
        user=prompts.MODEL_ESSAY_USER.format(
            topic=session["topic_text"],
            exam_label=exam_label,
            position=session["plan_position"],
            reasons=fmt_reasons(reasons),
        ),
    )

    result = safe_json(result_str)
    update_session(req.session_id, model_essay_json=result_str)
    return result


@app.get("/api/history")
async def history(user_id: str):
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    return {
        "stats": get_user_stats(user_id),
        "sessions": get_user_history(user_id),
    }
