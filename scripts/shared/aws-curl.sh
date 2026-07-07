#!/usr/bin/env bash
set -e

# This script is intended as a very simple drop in for signed AWS requests via
# curl so you don't have to set a ton of boilerplate up each time. There is
# already an awscurl tool [1], however it does not support streaming responses.
# [1]: https://github.com/okigan/awscurl
#
# Usage:
# $ ./aws-curl.sh https://12345.execute-api.eu-west-1.amazonaws.com/prod/
# $ ./aws-curl.sh --show-headers https://12345.execute-api.eu-west-1.amazonaws.com/prod/
# $ SERVICE=lambda ./aws-curl.sh https://123456.lambda-url.eu-west-1.on.aws/

# Setting SERVICE=lambda or similar as an arg can override this, in the future
# we could perhaps work this out automatically from the URL or provide a
# --service argument
SIG_V4="aws:amz:${AWS_REGION}:${SERVICE:-execute-api}"

curl --aws-sigv4 $SIG_V4 \
     --header "x-amz-security-token: $AWS_SESSION_TOKEN" \
     --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
     "$@"
