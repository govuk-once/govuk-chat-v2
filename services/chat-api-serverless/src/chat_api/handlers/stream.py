import time
from typing import Any


def lambda_handler(_event: dict[str, Any], _context: Any) -> dict[str, Any]:
    def stream():
        yield b"Starting stream...\n"

        for i in range(5):
            time.sleep(1)
            yield f"chunk {i}\n".encode("utf-8")

        yield b"Done.\n"

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/plain",
        },
        "body": stream(),
    }
