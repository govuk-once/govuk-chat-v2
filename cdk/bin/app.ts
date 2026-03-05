#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
  getEnvironment,
  getResourceNamePrefix,
  serviceMetadata,
} from '../constants/environment.ts';
import { ChatApiStack } from '../stacks/chat-api-stack.ts';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
};

new ChatApiStack(app, 'ChatApiStack', {
  env: env,
  environment: getEnvironment(),
  stackName: `${getResourceNamePrefix()}-ChatApiStack`,
  ...serviceMetadata,
});
