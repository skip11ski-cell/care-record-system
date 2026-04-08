from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models import Base


def _normalize_database_url(url: str) -> str:
    # Heroku / Render 等が postgres:// を返す場合がある（SQLAlchemy は postgresql:// を推奨）
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


database_url = _normalize_database_url(settings.database_url)
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _ensure_care_records_category_column() -> None:
    inspector = inspect(engine)
    if "care_records" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("care_records")}
    if "category" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE care_records ADD COLUMN category VARCHAR(32)"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_care_records_category_column()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
