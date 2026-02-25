FROM python:3.13-slim AS builder

WORKDIR /deps
COPY uv.lock pyproject.toml ./
COPY libs/python libs/python

RUN pip install uv==0.10.2
RUN uv export --frozen \
              --no-editable \
              --no-dev \
              --no-emit-project \
              --package chat-api-fastapi \
              -o requirements.txt
RUN uv pip install --no-installer-metadata \
                   --compile-bytecode \
                   --link-mode=copy \
                   --exact \
                   --no-deps \
                   --system \
                   --prefix=/install \
                   -r requirements.txt

FROM python:3.13-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY services/chat-api-fastapi .

RUN pip install --no-deps --no-cache-dir .

RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /bin/bash appuser \
    && chown -R appuser:appuser /app /usr/local

USER appuser

CMD ["uvicorn", "chat_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
