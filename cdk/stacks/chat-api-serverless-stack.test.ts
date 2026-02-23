import * as cdk from 'aws-cdk-lib';
import baseContext from '../cdk.json' with { type: 'json' };
import { Tags, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { ChatApiServerlessStack } from './chat-api-serverless-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('ChatApiServerlessStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
  };

  function stackTemplate() {
    const app = new cdk.App({ context });
    const stack = new ChatApiServerlessStack(app, 'TestStack', baseProps);
    return Template.fromStack(stack);
  }

  describe('Stack tags', () => {
    function stackTags() {
      const app = new cdk.App({ context });
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

  describe('Lambda functions', () => {
    it('creates a HelloWorld lambda', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'chat_api.handlers.example.lambda_handler',
      });
    });
  });
});
