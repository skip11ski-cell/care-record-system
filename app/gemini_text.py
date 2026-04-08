"""
Gemini API（REST）で介護記録テキストを整形。失敗時は None を返す。
API キーは app.config.settings の gemini_api_key（環境変数 GEMINI_API_KEY）。
"""

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)


async def rewrite_care_note_with_gemini(raw: str, category_label: str) -> Optional[str]:
    """
    整形に成功したら文字列、API 未設定・エラー・ブロック時は None。
    None のとき呼び出し側は原文を保存する。
    """
    key = settings.gemini_api_key.strip()
    if not key:
        return None

    model = (settings.gemini_model or "gemini-2.0-flash").strip()
    url = GEMINI_GENERATE_URL.format(model=model)
    prompt = (
        "あなたはデイサービスの介護記録を整えるアシスタントです。\n"
        "次の発話を、事実を変えず、介護記録として読みやすい短文に整えてください。\n"
        f"カテゴリ: {category_label}\n"
        "禁止: 推測の追加、個人名の捏造、カテゴリに無関係な内容の付け足し。\n\n"
        f"入力:\n{raw}\n\n"
        "出力は整えた記録文のみ。余計な説明や引用符は不要。"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.post(url, params={"key": key}, json=payload)
            if r.status_code >= 400:
                logger.warning(
                    "Gemini API error status=%s body=%s",
                    r.status_code,
                    r.text[:500],
                )
                return None
            data = r.json()
    except Exception:
        logger.exception("Gemini request failed")
        return None

    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError, TypeError) as e:
        logger.warning("Gemini response parse failed: %s data=%s", e, str(data)[:500])
        return None

    if not text:
        logger.warning("Gemini returned empty text: %s", str(data)[:500])
        return None
    return text
