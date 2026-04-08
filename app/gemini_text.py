"""
Gemini API（REST）で介護記録テキストを整形。失敗時は None を返す。
API キーは app.config.settings の gemini_api_key（環境変数 GEMINI_API_KEY）。

モデル名は Google 側の廃止・改名がありやすいため、404 時は別名を順に試します。
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

# 優先順（404 や利用不可のとき次を試す）。公式の安定名に合わせて随時更新。
_DEFAULT_MODEL_FALLBACKS = (
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
)


def _build_prompt(raw: str, category_label: str) -> str:
    return (
        "あなたはデイサービスの介護記録を整えるアシスタントです。\n"
        "次の発話を、事実を変えず、介護記録として読みやすい短文に整えてください。\n"
        f"カテゴリ: {category_label}\n"
        "禁止: 推測の追加、個人名の捏造、カテゴリに無関係な内容の付け足し。\n\n"
        f"入力:\n{raw}\n\n"
        "出力は整えた記録文のみ。余計な説明や引用符は不要。"
    )


def _extract_text_from_response(data: Dict[str, Any]) -> Optional[str]:
    """generateContent の JSON から本文を取り出す。ブロック・異常時は None。"""
    err = data.get("error")
    if err:
        logger.warning(
            "Gemini API error object: %s",
            str(err)[:800],
        )
        return None

    pf = data.get("promptFeedback") or {}
    if pf.get("blockReason"):
        logger.warning("Gemini prompt blocked: %s", pf)
        return None

    cands = data.get("candidates") or []
    if not cands:
        logger.warning("Gemini: no candidates in response keys=%s", list(data.keys()))
        return None

    first = cands[0]
    fr = first.get("finishReason")
    if fr and fr not in ("STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED", None):
        logger.warning("Gemini finishReason=%s (first candidate)", fr)

    content = first.get("content") or {}
    parts = content.get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
    return text or None


async def _generate_once(
    client: httpx.AsyncClient,
    model: str,
    api_key: str,
    prompt: str,
) -> Tuple[Optional[str], int, str]:
    """(本文 or None, HTTPステータス, ログ用メッセージ)"""
    url = GEMINI_GENERATE_URL.format(model=model)
    # role は付けず公式ドキュメントの最小形に近づける
    payload: Dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
        },
    }
    r = await client.post(url, params={"key": api_key}, json=payload)
    snippet = r.text[:1200] if r.text else ""
    if r.status_code >= 400:
        return None, r.status_code, snippet

    try:
        data = r.json()
    except Exception as e:
        return None, r.status_code, f"json_parse_error:{e}:{snippet}"

    text = _extract_text_from_response(data)
    if text:
        return text, r.status_code, "ok"
    return None, r.status_code, f"empty_or_blocked:{snippet[:600]}"


async def rewrite_care_note_with_gemini(raw: str, category_label: str) -> Optional[str]:
    """
    整形に成功したら文字列、API 未設定・エラー・ブロック時は None。
    """
    key = settings.gemini_api_key.strip()
    if not key:
        logger.info("Gemini: GEMINI_API_KEY 未設定のためスキップ")
        return None

    key_hint = f"{key[:4]}…{key[-4:]}" if len(key) >= 8 else "(short)"
    prompt = _build_prompt(raw, category_label)

    preferred = (settings.gemini_model or "").strip()
    models_order: List[str] = []
    if preferred:
        models_order.append(preferred)
    for m in _DEFAULT_MODEL_FALLBACKS:
        if m not in models_order:
            models_order.append(m)

    last_detail = ""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            for model in models_order:
                logger.info(
                    "Gemini: trying model=%s key=%s",
                    model,
                    key_hint,
                )
                text, status, detail = await _generate_once(client, model, key, prompt)
                last_detail = detail
                if text:
                    logger.info(
                        "Gemini: success model=%s status=%s chars=%d",
                        model,
                        status,
                        len(text),
                    )
                    return text

                if status == 404:
                    logger.warning(
                        "Gemini: model not available (404) model=%s — trying fallback",
                        model,
                    )
                    continue

                logger.warning(
                    "Gemini: failed model=%s status=%s detail=%s",
                    model,
                    status,
                    detail[:500],
                )
                # 400 番台でキー不正などはフォールバックしても無駄なことが多い
                if status in (400, 401, 403):
                    break
                continue

    except Exception:
        logger.exception("Gemini: HTTP クライアント例外")
        return None

    logger.warning("Gemini: 全モデルで失敗 last_detail=%s", last_detail[:800])
    return None
