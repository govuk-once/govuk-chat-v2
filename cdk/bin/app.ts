#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
  getEnvironment,
  getResourceNamePrefix,
  serviceMetadata,
} from '../src/constants/environment.ts';
import { ChatApiTsStack } from '../src/stacks/chat-api-ts-stack.ts';
import { ChatApiFastapiStack } from '../src/stacks/chat-api-fastapi-stack.ts';
import { ExampleAgentStack } from '../src/stacks/example-agent-stack.ts';
import { AgUiAgentStack } from '../src/stacks/agui-agent-stack.ts';

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

const exampleAgentStack = new ExampleAgentStack(app, 'ExampleAgentStack', {
  env: env,
  environment: getEnvironment(),
  githubToken: githubToken,
  stackName: `${getResourceNamePrefix()}-ExampleAgentStack`,
  ...serviceMetadata,
});

const aguiAgentStack = new AgUiAgentStack(app, 'AguiAgentStack', {
  env: env,
  environment: getEnvironment(),
  githubToken: githubToken,
  stackName: `${getResourceNamePrefix()}-AguiAgentStack`,
  ...serviceMetadata,
});

new ChatApiTsStack(app, 'ChatApiTsStack', {
  env: env,
  environment: getEnvironment(),
  agentRuntimeArn: aguiAgentStack.agentRuntimeArn,
  stackName: `${getResourceNamePrefix()}-ChatApiTsStack`,
  ...serviceMetadata,
});

new ChatApiFastapiStack(app, 'ChatApiFastapiStack', {
  env: env,
  environment: getEnvironment(),
  agentRuntimeArn: exampleAgentStack.agentRuntimeArn,
  stackName: `${getResourceNamePrefix()}-ChatApiFastapiStack`,
  ...serviceMetadata,
});
