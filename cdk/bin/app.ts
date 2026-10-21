#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
  getEnvironment,
  getResourceNamePrefix,
  serviceMetadata,
} from '../src/constants/environment.ts';
import { AguiAgentStack } from '../src/stacks/agui-agent-stack.ts';
import { ChatApiStack } from '../src/stacks/chat-api-stack.ts';
import { DemoUiStack } from '../src/stacks/demo-ui-stack.ts';

const app = new cdk.App();
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  throw new Error(
    'GITHUB_TOKEN environment variable is required but was not found.',
  );
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
};

const aguiAgentStack = new AguiAgentStack(app, 'AguiAgentStack', {
  env: env,
  environment: getEnvironment(),
  githubToken: githubToken,
  stackName: `${getResourceNamePrefix()}-AguiAgentStack`,
  ...serviceMetadata,
});

const chatApiStack = new ChatApiStack(app, 'ChatApiStack', {
  env: env,
  environment: getEnvironment(),
  agentRuntimeArn: aguiAgentStack.agentRuntimeArn,
  stackName: `${getResourceNamePrefix()}-ChatApiStack`,
  ...serviceMetadata,
});

new DemoUiStack(app, 'DemoUiStack', {
  env: env,
  environment: getEnvironment(),
  chatApiUrl: chatApiStack.gatewayUrl,
  cognitoTokenEndpoint: chatApiStack.tokenEndpoint,
  cognitoUserPoolId: chatApiStack.userPoolId,
  cognitoUserPoolArn: chatApiStack.userPoolArn,
  cognitoAppClientId: chatApiStack.appClientId,
  stackName: `${getResourceNamePrefix()}-DemoUiStack`,
  ...serviceMetadata,
});
