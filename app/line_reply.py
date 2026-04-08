import httpx

from app.config import settings

LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"


async def reply_text(reply_token: str, text: str) -> None:
    token = settings.line_channel_access_token.strip()
    if not token or not reply_token:
        return
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": text}],
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(LINE_REPLY_URL, headers=headers, json=payload)
        r.raise_for_status()
