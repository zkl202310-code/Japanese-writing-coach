import logging
import os
import time

import httpx
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("jwritecoach.llm")

# Bound a hung DeepSeek call instead of the SDK's 600s default; one retry rides
# out a transient 5xx/connection blip. Both tunable via env without a redeploy.
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "90"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "1"))

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com",
            timeout=httpx.Timeout(LLM_TIMEOUT, connect=10.0),
            max_retries=LLM_MAX_RETRIES,
        )
    return _client


def chat(system: str, user: str, temperature: float = 0.7) -> str:
    client = get_client()
    t0 = time.perf_counter()
    response = client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
    )
    logger.info("chat() finished in %.1fs", time.perf_counter() - t0)
    return response.choices[0].message.content


def chat_json(system: str, user: str) -> str:
    client = get_client()
    t0 = time.perf_counter()
    response = client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.3,
        response_format={"type": "json_object"},
    )
    logger.info("chat_json() finished in %.1fs", time.perf_counter() - t0)
    return response.choices[0].message.content


def chat_stream(system: str, user: str, temperature: float = 0.7):
    """Yield answer-text chunks as they arrive, for the plain-text endpoints.

    Thinking mode is disabled so the answer streams from the first token —
    otherwise deepseek-v4-pro emits its whole reasoning trace first, which would
    block the first visible token and defeat streaming. With thinking off the
    temperature actually takes effect too.
    """
    client = get_client()
    t0 = time.perf_counter()
    stream = client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        stream=True,
        extra_body={"thinking": {"type": "disabled"}},
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        piece = chunk.choices[0].delta.content
        if piece:
            yield piece
    logger.info("chat_stream() finished in %.1fs", time.perf_counter() - t0)


def ping() -> None:
    """Minimal call to verify the API key + connectivity. Raises on failure.
    Uses a short timeout so a slow API doesn't make /api/health hang."""
    client = get_client()
    client.with_options(timeout=15.0).chat.completions.create(
        model="deepseek-v4-pro",
        messages=[{"role": "user", "content": "ping"}],
        max_tokens=1,
    )


# ---- Handwriting OCR (provider-agnostic, plug-and-play) ----
# DeepSeek's chat API does NOT accept image input yet (verified 2026-06: it
# rejects the `image_url` content variant). This is written in the OpenAI-
# compatible image_url format that DeepSeek's vision update is expected to use,
# so when it ships you flip OCR_ENABLED=1 (and set OCR_MODEL to the vision model
# id) and it works — no code change. To use a different vision provider in the
# meantime, point OCR_BASE_URL / OCR_API_KEY / OCR_MODEL at it.
OCR_ENABLED = os.getenv("OCR_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")
OCR_MODEL = os.getenv("OCR_MODEL", "deepseek-v4-pro")
OCR_BASE_URL = os.getenv("OCR_BASE_URL", "https://api.deepseek.com")

_ocr_client = None


def _get_ocr_client() -> OpenAI:
    global _ocr_client
    if _ocr_client is None:
        _ocr_client = OpenAI(
            api_key=os.getenv("OCR_API_KEY") or os.getenv("DEEPSEEK_API_KEY"),
            base_url=OCR_BASE_URL,
        )
    return _ocr_client


class OCRUnavailable(Exception):
    """Raised when image OCR isn't available (disabled, or model lacks vision)."""


OCR_PROMPT = (
    "あなたは日本語の手書き文字を読み取るOCRエンジンです。"
    "画像に写っている手書きの作文・文章を、できるだけ正確にそのまま書き写してください。"
    "改行や段落はそのまま保持し、本文のテキストだけを出力してください。"
    "判読できない文字は［?］と記してください。"
    "説明・前置き・コメントは一切付けないでください。"
)


def vision_ocr(image_urls: list[str]) -> str:
    """Transcribe handwritten text from one or more image data-URLs.

    Raises OCRUnavailable if OCR is off or the configured model can't take images.
    """
    if not OCR_ENABLED:
        raise OCRUnavailable("OCR disabled (set OCR_ENABLED=1 once vision is available)")
    client = _get_ocr_client()
    content = [{"type": "text", "text": OCR_PROMPT}]
    content += [{"type": "image_url", "image_url": {"url": u}} for u in image_urls]
    try:
        response = client.chat.completions.create(
            model=OCR_MODEL,
            messages=[{"role": "user", "content": content}],
            temperature=0,
        )
    except Exception as e:
        # The current DeepSeek API returns this when it can't accept images yet.
        msg = str(e)
        if "image_url" in msg and ("unknown variant" in msg or "expected" in msg):
            raise OCRUnavailable("configured model does not support image input yet") from e
        raise
    return response.choices[0].message.content or ""
