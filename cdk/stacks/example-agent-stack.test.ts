import * as cdk from 'aws-cdk-lib';
import baseContext from '../cdk.json' with { type: 'json' };
import { Tags, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { ExampleAgentStack } from './example-agent-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('ExampleAgentStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
  };

  function stackTemplate() {
    const app = new cdk.App({ context });
    const stack = new ExampleAgentStack(app, 'TestStack', baseProps);
    return Template.fromStack(stack);
  }

  describe('Stack tags', () => {
    function stackTags() {
      const app = new cdk.App({ context });
      const stack = new ExampleAgentStack(app, 'TestStack', baseProps);
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

  describe('AgentCore runtime', () => {
    it('creates an AgentCore runtime resource', () => {
      const template = stackTemplate();

      template.hasResource('AWS::BedrockAgentCore::Runtime', {});
    });

    it('creates an AgentCore memory resource and sets the env var on the runtime resource', () => {
      const template = stackTemplate();

      template.hasResource('AWS::BedrockAgentCore::Memory', {});
    });

    it('outputs the name', () => {
      const template = stackTemplate();

      template.hasOutput('AgentRuntimeName', {});
    });

    it('outputs the arn', () => {
      const template = stackTemplate();

      template.hasOutput('AgentRuntimeArn', {});
    });
  });
});
