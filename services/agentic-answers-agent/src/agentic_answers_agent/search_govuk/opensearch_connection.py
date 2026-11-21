import json
from dataclasses import dataclass, field
from typing import Self

import boto3

# Chat V1's OpenSearch connection details, in the dev account only for now.
SECRET_NAME = "govuk-chat-v2-opensearch"
AWS_REGION = "eu-west-1"


@dataclass(frozen=True)
class OpenSearchSettings:
    url: str
    index: str
    username: str
    password: str = field(repr=False)
    embedding_field_name: str
    embedding_model: str

    @classmethod
    def from_secret_string(cls, secret_string: str) -> Self:
        values = json.loads(secret_string)
        return cls(
            url=values["OPENSEARCH_URL"],
            index=values["OPENSEARCH_INDEX"],
            username=values["OPENSEARCH_USERNAME"],
            password=values["OPENSEARCH_PASSWORD"],
            embedding_field_name=values["OPENSEARCH_EMBEDDING_FIELD_NAME"],
            embedding_model=values["OPENSEARCH_EMBEDDING_MODEL"],
        )


def read_opensearch_settings() -> OpenSearchSettings:
    secrets_manager = boto3.client("secretsmanager", region_name=AWS_REGION)
    secret = secrets_manager.get_secret_value(SecretId=SECRET_NAME)
    return OpenSearchSettings.from_secret_string(secret["SecretString"])
