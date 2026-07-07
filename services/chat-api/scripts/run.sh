#!/usr/bin/env bash
set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

${PROJECT_DIR}/../../scripts/shared/check-dev-aws-credentials.sh

cd "$PROJECT_DIR" || exit 1

echo ""
echo "== Checking for deployed AgentCore agent =="
environment_name=$(whoami | tr -cd '[:alnum:]')
stack_name=$(aws cloudformation describe-stacks \
  --query "Stacks[?Tags[?Key=='Environment' && Value=='${environment_name}']].StackName" \
  --output text | tr '\t' '\n' | grep 'ExampleAgentStack')

if [ -z "$stack_name" ]; then
  echo "No ExampleAgentStack stack found tagged with Environment=${environment_name}"
  echo "Run ./scripts/cdk-deploy.sh in the example-agent directory to deploy the stack"
  exit 1
fi

AGENT_RUNTIME_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeArn'].OutputValue" \
  --output text)

if [ -z "$AGENT_RUNTIME_ARN" ] || [ "$AGENT_RUNTIME_ARN" = "None" ]; then
  echo "No AgentRuntimeArn output found on stack ${stack_name}."
  exit 1
fi

echo "Using agent $AGENT_RUNTIME_ARN"
export AGENT_RUNTIME_ARN

echo ""
echo "== Starting app =="

# Using uvicorn rather than FastAPI CLI to have extra reload dirs (FastAPI CLI
# delegate to uvicorn anyway)
uv run uvicorn chat_api.main:app \
    --reload \
    --reload-dir . \
    --reload-dir ../../libs/python/chat-assistants
