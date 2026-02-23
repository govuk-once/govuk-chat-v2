from datetime import datetime, timezone
from chat_api.handlers.example import lambda_handler, User


def test_lambda_handler_returns_200():
    response = lambda_handler({}, None)

    assert response["statusCode"] == 200


def test_lambda_handler_returns_a_json_model(freezer):
    response = lambda_handler({}, None)
    model = User(id=1, name="Alice", joined_at=datetime.now(tz=timezone.utc))

    assert response["body"] == model.model_dump_json()
