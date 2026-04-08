import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qs

from sqlalchemy.orm import Session

from app.config import settings
from app.categories import DEFAULT_CATEGORY_LABEL, POSTBACK_KEY_TO_LABEL
from app.database import SessionLocal
from app.gemini_text import rewrite_care_note_with_gemini
from app.line_reply import reply_text
from app.models import CareRecord, LineUserCategoryState

logger = logging.getLogger(__name__)


def _parse_postback_data(data: str) -> Dict[str, str]:
    """postback data は cat=vital のような形式を想定"""
    if not data:
        return {}
    q = parse_qs(data, keep_blank_values=True)
    return {k: v[0] if v else "" for k, v in q.items()}


async def handle_line_event(ev: Dict[str, Any]) -> None:
    ev_type = ev.get("type")
    reply_token = ev.get("replyToken")
    source = ev.get("source") or {}
    user_id = source.get("userId") or "unknown"

    if ev_type == "postback":
        await _handle_postback(user_id, reply_token, ev)
        return
    if ev_type == "message":
        await _handle_message(user_id, reply_token, ev)
        return


async def _handle_postback(user_id: str, reply_token: Optional[str], ev: Dict[str, Any]) -> None:
    raw = (ev.get("postback") or {}).get("data") or ""
    params = _parse_postback_data(raw)
    key = (params.get("cat") or "").strip()
    label = POSTBACK_KEY_TO_LABEL.get(key)
    if not label:
        logger.warning("Unknown postback cat=%s", key)
        try:
            await reply_text(reply_token, "メニューの選択を認識できませんでした。もう一度タップしてください。")
        except Exception:
            logger.exception("LINE reply failed")
        return

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        row = db.get(LineUserCategoryState, user_id)
        if row is None:
            row = LineUserCategoryState(line_user_id=user_id, category_label=label, updated_at=now)
            db.add(row)
        else:
            row.category_label = label
            row.updated_at = now
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("postback DB failed")
        raise
    finally:
        db.close()

    try:
        await reply_text(
            reply_token,
            f"「{label}」で記録します。\n内容を送信してください。",
        )
    except Exception:
        logger.exception("LINE reply failed (postback)")


async def _handle_message(user_id: str, reply_token: Optional[str], ev: Dict[str, Any]) -> None:
    msg = ev.get("message") or {}
    if msg.get("type") != "text":
        return
    text = (msg.get("text") or "").strip()
    if not text:
        return

    db = SessionLocal()
    cat_display = DEFAULT_CATEGORY_LABEL
    try:
        state = db.get(LineUserCategoryState, user_id)
        if state is None:
            cat_display = DEFAULT_CATEGORY_LABEL
        else:
            cat_display = state.category_label

        body = text
        ai_failed = False
        ai_ok = False
        if settings.gemini_api_key.strip():
            rewritten = await rewrite_care_note_with_gemini(text, cat_display)
            if rewritten is None:
                body = text
                ai_failed = True
            else:
                body = rewritten
                ai_ok = True

        rec = CareRecord(
            line_user_id=user_id,
            message_text=body,
            category=cat_display,
        )
        db.add(rec)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("message DB failed")
        raise
    finally:
        db.close()
    try:
        if settings.gemini_api_key.strip() and ai_failed:
            await reply_text(
                reply_token,
                "AI変換に失敗しました。原文をそのまま記録しています。",
            )
        elif ai_ok:
            await reply_text(
                reply_token,
                f"記録しました。（{cat_display}・AI整形済み）",
            )
        else:
            await reply_text(reply_token, f"記録しました。（{cat_display}）")
    except Exception:
        logger.exception("LINE reply failed (message)")
