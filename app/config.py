from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    line_channel_secret: str = ""
    line_channel_access_token: str = ""
    app_public_base_url: str = ""
    database_url: str = "sqlite:///./care_records.db"
    dev_skip_line_signature: bool = False

    # Render 等の環境変数 GEMINI_API_KEY がそのまま読み込まれる（フィールド名 gemini_api_key）
    gemini_api_key: str = ""
    # 例: gemini-2.0-flash / gemini-1.5-flash
    gemini_model: str = "gemini-2.0-flash"


settings = Settings()
