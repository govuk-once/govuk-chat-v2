FROM public.ecr.aws/docker/library/python:3.13-slim AS builder

WORKDIR /deps
RUN pip install uv==0.10.2

COPY uv.lock pyproject.toml ./
COPY libs/python libs/python

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

FROM public.ecr.aws/docker/library/python:3.13-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.0-rc1 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /var/task

ENV PYTHONPATH=/var/task/deps/lib/python3.13/site-packages

COPY --from=builder /install /var/task/deps
COPY services/chat-api-fastapi/src .

CMD ["python", "-m", "uvicorn", "chat_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
