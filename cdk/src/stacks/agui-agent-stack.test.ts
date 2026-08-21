import * as cdk from 'aws-cdk-lib';
import baseContext from '../../cdk.json' with { type: 'json' };
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { Tags, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, vi } from 'vitest';
import { AguiAgentStack } from './agui-agent-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('AguiAgentStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
    githubToken: 'fake-token',
  };

  function stackTemplate() {
    const app = new cdk.App({ context });
    const stack = new AguiAgentStack(app, 'TestStack', baseProps);
    return Template.fromStack(stack);
  }

  function stackTags() {
    const app = new cdk.App({ context });
    const stack = new AguiAgentStack(app, 'TestStack', baseProps);
    return Tags.fromStack(stack);
  }

  it('passes the token all the way to AgentRuntimeArtifact.fromCodeAsset', () => {
    const fromAssetSpy = vi.spyOn(
      agentcore.AgentRuntimeArtifact,
      'fromCodeAsset',
    );

    const app = new cdk.App({ context });
    const expectedToken = 'expected-token';

    new AguiAgentStack(app, 'TestStack', {
      ...baseProps,
      githubToken: expectedToken,
    });

    expect(fromAssetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bundling: expect.objectContaining({
          environment: expect.objectContaining({
            GITHUB_TOKEN: expectedToken,
          }),
        }),
      }),
    );
    fromAssetSpy.mockRestore();
  });

  describe('Stack tags', () => {
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

    it('outputs the execution role arn', () => {
      const template = stackTemplate();

      template.hasOutput('AgentRuntimeRoleArn', {});
    });

    it('outputs the memory arn', () => {
      const template = stackTemplate();

      template.hasOutput('ShortTermMemoryArn', {});
    });
  });
});
