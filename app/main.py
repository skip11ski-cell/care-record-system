import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, init_db
from app.line_handlers import handle_line_event
from app.line_verify import verify_line_signature
from app.models import CareRecord

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Render ログで実行スタックを確認しやすくする（Node / OpenAI 旧構成との切り分け用）
    gk = settings.gemini_api_key.strip()
    logger.info(
        "Starting care-record API (Python/FastAPI, uvicorn). "
        "AI整形: Gemini %s",
        "有効 (GEMINI_API_KEY 設定済み)" if gk else "未使用 (キーなし)",
    )
    yield


app = FastAPI(title="介護記録 LINE 連携", lifespan=lifespan)


def _to_jst(dt: Optional[datetime]) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(JST).strftime("%Y-%m-%d %H:%M")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db)):
    rows = db.query(CareRecord).order_by(desc(CareRecord.created_at)).limit(200).all()
    items = [
        {
            "id": r.id,
            "created_jst": _to_jst(r.created_at),
            "category": r.category or "未分類",
            "line_user_id": r.line_user_id,
            "message_text": r.message_text,
        }
        for r in rows
    ]
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "records": items, "count": len(items)},
    )


@app.get("/api/records")
def api_records(db: Session = Depends(get_db)):
    rows = db.query(CareRecord).order_by(desc(CareRecord.created_at)).limit(500).all()
    return {
        "records": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "category": r.category or "未分類",
                "line_user_id": r.line_user_id,
                "message_text": r.message_text,
            }
            for r in rows
        ]
    }


@app.post("/callback")
async def line_callback(
    request: Request,
    x_line_signature: Optional[str] = Header(None, alias="X-Line-Signature"),
):
    body = await request.body()

    secret = settings.line_channel_secret.strip()
    if settings.dev_skip_line_signature:
        logger.warning("DEV_SKIP_LINE_SIGNATURE: 署名検証をスキップしています")
    elif not secret:
        raise HTTPException(status_code=500, detail="LINE_CHANNEL_SECRET が未設定です")
    elif not verify_line_signature(body, x_line_signature, secret):
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        data = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    events = data.get("events") or []
    for ev in events:
        await handle_line_event(ev)

    return {"status": "ok"}
