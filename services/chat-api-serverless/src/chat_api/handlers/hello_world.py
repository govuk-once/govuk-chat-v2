from pydantic import BaseModel
from datetime import datetime, timezone

class User(BaseModel):
    id: int
    name: str
    joined_at: datetime

def lambda_handler(_event, _context):
    user = User(id=1, name="Alice", joined_at=datetime.now(tz=timezone.utc))
    return {
        'statusCode': 200,
        'body': user.model_dump_json()
    }
