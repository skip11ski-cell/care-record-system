from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class CareRecord(Base):
    __tablename__ = "care_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    line_user_id: Mapped[str] = mapped_column(String(64), index=True)
    message_text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)


class LineUserCategoryState(Base):
    """リッチメニューで選んだカテゴリ（次のテキスト送信まで保持）"""

    __tablename__ = "line_user_category_state"

    line_user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    category_label: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
