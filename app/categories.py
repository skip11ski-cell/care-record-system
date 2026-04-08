# リッチメニュー postback の cat= と表示名の対応
# 順序: 上段左→右、下段左→右（各スクリプト・テンプレートと一致させる）

from typing import List, Tuple

CATEGORY_DEFS: List[Tuple[str, str]] = [
    ("vital", "バイタル"),
    ("bath", "入浴"),
    ("meal", "食事"),
    ("exercise", "体操レク"),
    ("other", "その他"),
    ("supervisor", "サ責に連絡"),
]

POSTBACK_KEY_TO_LABEL = {k: label for k, label in CATEGORY_DEFS}
DEFAULT_CATEGORY_LABEL = "未分類"
