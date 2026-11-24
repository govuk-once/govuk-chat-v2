import json
from dataclasses import dataclass, field
from typing import Self

import boto3

SECRET_NAME = "govuk-chat-v2-opensearch"
AWS_REGION = "eu-west-1"


@dataclass(frozen=True)
class OpenSearchConnection:
    url: str
    index: str
    username: str
    password: str = field(repr=False)

    @classmethod
    def from_secret_string(cls, secret_string: str) -> Self:
        values = json.loads(secret_string)
        return cls(
            url=values["OPENSEARCH_URL"],
            index=values["OPENSEARCH_INDEX"],
            username=values["OPENSEARCH_USERNAME"],
            password=values["OPENSEARCH_PASSWORD"],
        )


def read_opensearch_connection() -> OpenSearchConnection:
    secrets_manager = boto3.client("secretsmanager", region_name=AWS_REGION)
    secret = secrets_manager.get_secret_value(SecretId=SECRET_NAME)
    return OpenSearchConnection.from_secret_string(secret["SecretString"])
