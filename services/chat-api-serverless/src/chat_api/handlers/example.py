from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel


class User(BaseModel):
    id: int
    name: str
    joined_at: datetime


def lambda_handler(_event: dict[str, Any], _context: Any) -> dict[str, Any]:
    user = User(id=1, name="Alice", joined_at=datetime.now(tz=timezone.utc))
    return {"statusCode": 200, "body": user.model_dump_json()}
