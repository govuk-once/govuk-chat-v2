#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
  getEnvironment,
  getResourceNamePrefix,
  serviceMetadata,
} from '../constants/environment.ts';
import { ChatApiServerlessStack } from '../stacks/chat-api-serverless-stack.ts';

const app = new cdk.App();
new ChatApiServerlessStack(app, 'ChatApiServerlessStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  },
  environment: getEnvironment(),
  stackName: `${getResourceNamePrefix()}-ChatApiServerlessStack`,
  ...serviceMetadata,
});
