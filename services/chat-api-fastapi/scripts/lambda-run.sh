#!/bin/bash

# Script to be used by AWS Lambda when deployed to run the application

PATH=$PATH:$LAMBDA_TASK_ROOT/bin \
    PYTHONPATH=$PYTHONPATH:/opt/python:$LAMBDA_RUNTIME_DIR \
    exec python -m uvicorn --port=$PORT chat_api.main:app
