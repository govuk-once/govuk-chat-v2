#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
  getEnvironment,
  getResourceNamePrefix,
  serviceMetadata,
} from '../constants/environment.ts';
import { ChatApiFastapiStack } from '../stacks/chat-api-fastapi-stack.ts';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
};

new ChatApiFastapiStack(app, 'ChatApiFastapiStack', {
  env: env,
  environment: getEnvironment(),
  stackName: `${getResourceNamePrefix()}-ChatApiFastapiStack`,
  ...serviceMetadata,
});
