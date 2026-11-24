import * as cdk from 'aws-cdk-lib';
import baseContext from '../../cdk.json' with { type: 'json' };
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Match, Tags, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, vi } from 'vitest';
import { AgenticAnswersAgentStack } from './agentic-answers-agent-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('AgenticAnswersAgentStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
    githubToken: 'fake-token',
  };

  function stackTemplate() {
    const app = new cdk.App({ context });
    const stack = new AgenticAnswersAgentStack(app, 'TestStack', baseProps);
    return Template.fromStack(stack);
  }

  function stackTags() {
    const app = new cdk.App({ context });
    const stack = new AgenticAnswersAgentStack(app, 'TestStack', baseProps);
    return Tags.fromStack(stack);
  }

  it('passes the token all the way to AgentRuntimeArtifact.fromCodeAsset', () => {
    const fromAssetSpy = vi.spyOn(
      agentcore.AgentRuntimeArtifact,
      'fromCodeAsset',
    );

    const app = new cdk.App({ context });
    const expectedToken = 'expected-token';

    new AgenticAnswersAgentStack(app, 'TestStack', {
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

    it('grants the runtime read access to the OpenSearch secret', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            }),
          ]),
        },
      });
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

    it('lets the runtime delete memory events, so Strands can redact blocked turns', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['bedrock-agentcore:DeleteEvent']),
            }),
          ]),
        },
      });
    });
  });

  describe('Guardrail', () => {
    it('creates a guardrail and one version of it', () => {
      const template = stackTemplate();

      template.resourceCountIs('AWS::Bedrock::Guardrail', 1);
      template.resourceCountIs('AWS::Bedrock::GuardrailVersion', 1);
    });

    it("gives the runtime the guardrail's id and version", () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
        EnvironmentVariables: Match.objectLike({
          GUARDRAIL_ID: Match.anyValue(),
          GUARDRAIL_VERSION: Match.anyValue(),
        }),
      });
    });

    it('lets the runtime apply the guardrail', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'bedrock:ApplyGuardrail' }),
          ]),
        },
      });
    });

    it('outputs the guardrail id and version', () => {
      const template = stackTemplate();

      template.hasOutput('GuardrailId', {});
      template.hasOutput('GuardrailVersion', {});
    });
  });
});
