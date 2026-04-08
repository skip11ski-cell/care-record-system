#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LINE リッチメニュー（6区分）を作成し、全ユーザー向けのデフォルトとして適用します。

■ 実行する場所
  このファイルがあるフォルダの「ひとつ上」がプロジェクトルートです。
  プロジェクトルートには app/ と requirements.txt があります。

  例:
    cd "/Users/あなた/Documents/Cursorファイル/介護記録LINE入力パソコン記録"
    ls scripts/create_rich_menu.py

■ 事前準備
    pip install httpx pillow
    export LINE_CHANNEL_ACCESS_TOKEN='（Messaging API のチャネルアクセストークン）'

■ 実行
    python scripts/create_rich_menu.py
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from app.categories import CATEGORY_DEFS  # noqa: E402

# メニュー定義の作成・既定化は api.line.me、画像バイナリのアップロードは api-data.line.me（公式仕様）
RICHMENU_API = "https://api.line.me/v2/bot/richmenu"
RICHMENU_CONTENT_UPLOAD_API = "https://api-data.line.me/v2/bot/richmenu"

# 太めのゴシックを優先（読みやすさ優先）
_FONT_PATH_CANDIDATES = (
    "/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def _resolve_font_path() -> Optional[str]:
    for path in _FONT_PATH_CANDIDATES:
        if os.path.isfile(path):
            return path
    return None


def _label_text_for_image(single_line_label: str) -> str:
    """画像上のみ。長い「サ責に連絡」は2行にして1文字あたりを大きくする。"""
    if single_line_label == "サ責に連絡":
        return "サ責に\n連絡"
    return single_line_label


def _max_font_size(
    measure_draw: ImageDraw.ImageDraw,
    text: str,
    font_path: str,
    max_w: int,
    max_h: int,
    min_size: int = 40,
    max_size: int = 155,
) -> int:
    """セル内に収まる最大のフォントサイズ（はっきり見えるよう大きめから探索）。"""
    for size in range(max_size, min_size - 1, -2):
        try:
            font = ImageFont.truetype(font_path, size)
        except OSError:
            return min_size
        spacing = max(10, int(size * 0.2))
        bbox = measure_draw.textbbox((0, 0), text, font=font, spacing=spacing)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        if tw <= max_w and th <= max_h:
            return size
    return min_size


def _cell_bounds(index: int) -> dict:
    row, col = index // 3, index % 3
    xs = [0, 833, 1666]
    ws = [833, 833, 834]
    ys = [0, 421]
    hs = [421, 422]
    return {"x": xs[col], "y": ys[row], "width": ws[col], "height": hs[row]}


def _build_rich_menu_payload() -> dict:
    areas = []
    for i, (key, label) in enumerate(CATEGORY_DEFS):
        b = _cell_bounds(i)
        areas.append(
            {
                "bounds": b,
                "action": {
                    "type": "postback",
                    "data": f"cat={key}",
                    "displayText": label,
                },
            }
        )
    return {
        "size": {"width": 2500, "height": 843},
        "selected": False,
        "name": "kaigo_record_categories",
        "chatBarText": "記録メニュー",
        "areas": areas,
    }


def _make_placeholder_png() -> bytes:
    img = Image.new("RGB", (2500, 843), color=(235, 238, 242))
    draw = ImageDraw.Draw(img)
    palette = [
        (214, 252, 245),
        (198, 236, 255),
        (255, 244, 200),
        (238, 224, 255),
        (255, 214, 214),
        (214, 252, 230),
    ]
    font_path = _resolve_font_path()
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    for i, (_, single_label) in enumerate(CATEGORY_DEFS):
        b = _cell_bounds(i)
        x0, y0 = b["x"], b["y"]
        x1, y1 = x0 + b["width"] - 1, y0 + b["height"] - 1
        draw.rectangle([x0, y0, x1, y1], fill=palette[i % len(palette)], outline=(70, 70, 90), width=4)

        text = _label_text_for_image(single_label)
        # 内側余白（文字を大きくしつつはみ出し防止）
        pad_x, pad_y = 28, 22
        inner_w = b["width"] - pad_x * 2
        inner_h = b["height"] - pad_y * 2

        if font_path:
            size = _max_font_size(measure, text, font_path, inner_w, inner_h)
            font = ImageFont.truetype(font_path, size)
            spacing = max(10, int(size * 0.2))
            stroke_w = max(4, min(14, size // 13))
        else:
            font = ImageFont.load_default()
            spacing = 8
            stroke_w = 1

        cx = x0 + b["width"] // 2
        cy = y0 + b["height"] // 2
        draw.text(
            (cx, cy),
            text,
            font=font,
            fill=(16, 18, 22),
            anchor="mm",
            spacing=spacing,
            stroke_width=stroke_w,
            stroke_fill=(255, 255, 255),
        )

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    if not token:
        print("環境変数 LINE_CHANNEL_ACCESS_TOKEN を設定してください。", file=sys.stderr)
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}"}

    payload = _build_rich_menu_payload()
    png = _make_placeholder_png()

    with httpx.Client(timeout=60.0) as client:
        r = client.post(RICHMENU_API, headers={**headers, "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            print(r.text, file=sys.stderr)
            r.raise_for_status()
        rich_menu_id = r.json()["richMenuId"]
        print("richMenuId:", rich_menu_id)

        upload_url = f"{RICHMENU_CONTENT_UPLOAD_API}/{rich_menu_id}/content"
        r2 = client.post(
            upload_url,
            headers={**headers, "Content-Type": "image/png"},
            content=png,
        )
        if r2.status_code >= 400:
            print(r2.text, file=sys.stderr)
            r2.raise_for_status()
        print("画像をアップロードしました。")

        r3 = client.post(
            f"https://api.line.me/v2/bot/user/all/richmenu/{rich_menu_id}",
            headers=headers,
        )
        if r3.status_code >= 400:
            print(r3.text, file=sys.stderr)
            r3.raise_for_status()
        print("デフォルトのリッチメニューとして設定しました。")


if __name__ == "__main__":
    main()
