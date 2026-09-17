#!/usr/bin/env bash
set -e

# Fetches a JWT from a Cognito token endpoint using the client credentials
# flow and the client's API Gateway key, then curls the given URL with the
# token as a Bearer header and the key as an x-api-key header.
#
# Usage:
# $ TOKEN_ENDPOINT=xxx USER_POOL_ID=yyy APP_CLIENT_ID=zzz API_KEY_ID=www -X POST -d '{"message":"hi"}' https://12345.execute-api.eu-west-1.amazonaws.com

if [ -z "$TOKEN_ENDPOINT" ]; then
  echo "TOKEN_ENDPOINT is blank" >&2; exit 1
fi
if [ -z "$USER_POOL_ID" ]; then
  echo "USER_POOL_ID is blank" >&2; exit 1
fi
if [ -z "$APP_CLIENT_ID" ]; then
  echo "APP_CLIENT_ID is blank" >&2; exit 1
fi
if [ -z "$API_KEY_ID" ]; then
  echo "API_KEY_ID is blank" >&2; exit 1
fi

APP_CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --query "UserPoolClient.ClientSecret" \
  --output text)

if [ -z "$APP_CLIENT_SECRET" ] || [ "$APP_CLIENT_SECRET" = "None" ]; then
  echo "Failed to fetch client secret for APP_CLIENT_ID=$APP_CLIENT_ID" >&2
  exit 1
fi

API_KEY=$(aws apigateway get-api-key \
  --api-key "$API_KEY_ID" \
  --include-value \
  --query "value" \
  --output text)

if [ -z "$API_KEY" ] || [ "$API_KEY" = "None" ]; then
  echo "Failed to fetch API key value for API_KEY_ID=$API_KEY_ID" >&2
  exit 1
fi

TOKEN=$(curl --silent --fail \
  --request POST "$TOKEN_ENDPOINT" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --user "${APP_CLIENT_ID}:${APP_CLIENT_SECRET}" \
  --data "grant_type=client_credentials&scope=chat-api/invoke" \
  | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Failed to fetch access token from $TOKEN_ENDPOINT" >&2
  exit 1
fi

curl --header "Authorization: Bearer ${TOKEN}" \
  --header "x-api-key: ${API_KEY}" "$@"
