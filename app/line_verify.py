import base64
import hashlib
import hmac
from typing import Optional


def verify_line_signature(body: bytes, signature: Optional[str], channel_secret: str) -> bool:
    if not signature or not channel_secret:
        return False
    mac = hmac.new(channel_secret.encode("utf-8"), body, hashlib.sha256).digest()
    expected = base64.b64encode(mac).decode("utf-8")
    return hmac.compare_digest(expected, signature)
