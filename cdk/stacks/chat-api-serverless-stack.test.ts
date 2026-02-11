import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { ChatApiServerlessStack } from './chat-api-serverless-stack.ts';

describe('ChatApiServerlessStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
  };

  describe('Stack tags', () => {
    function stackTags() {
      const app = new cdk.App();
      const stack = new ChatApiServerlessStack(app, 'TestStack', baseProps);
      return Tags.fromStack(stack);
    }

    it('sets common tags ', () => {
      stackTags().hasValues({
        ServiceName: baseProps.serviceName,
        TeamName: baseProps.teamName,
        RepositoryUrl: baseProps.repositoryUrl,
        Environment: baseProps.environment,
      });
    });
  });
});
