import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { agentCoreCodeAsset } from '../bundling/python.ts';
import { getResourceNamePrefix } from '../constants/environment.ts';
import { basicGuardrailConfig } from '../bedrock-guardrail-configs/basic-guardrail.ts';
import { VersionedBedrockGuardrail } from '../constructs/versioned-bedrock-guardrail.ts';

const OPENSEARCH_SECRET_NAME = 'govuk-chat-v2-opensearch';

export interface AgenticAnswersAgentStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  environment: string;
  githubToken: string;
}

export class AgenticAnswersAgentStack extends cdk.Stack {
  public readonly agentRuntimeArn: string;

  constructor(
    scope: Construct,
    id: string,
    props: AgenticAnswersAgentStackProps,
  ) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const shortTermMemory = this.createShortTermMemory();
    const guardrail = this.createGuardrail();
    const runtime = this.agentcoreRuntime(
      shortTermMemory.memoryId,
      guardrail,
      props.githubToken,
    );
    this.agentRuntimeArn = runtime.agentRuntimeArn;

    new cdk.CfnOutput(this, 'AgentRuntimeName', {
      value: runtime.agentRuntimeName,
    });

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: runtime.agentRuntimeArn,
    });

    new cdk.CfnOutput(this, 'AgentRuntimeRoleArn', {
      value: runtime.role.roleArn,
    });

    new cdk.CfnOutput(this, 'ShortTermMemoryId', {
      value: shortTermMemory.memoryId,
    });

    new cdk.CfnOutput(this, 'ShortTermMemoryArn', {
      value: shortTermMemory.memoryArn,
    });

    new cdk.CfnOutput(this, 'GuardrailId', {
      value: guardrail.guardrailId,
    });

    new cdk.CfnOutput(this, 'GuardrailVersion', {
      value: guardrail.guardrailVersion,
    });
  }

  createGuardrail(): VersionedBedrockGuardrail {
    return new VersionedBedrockGuardrail(this, 'Guardrail', {
      name: `${getResourceNamePrefix()}-agentic-answers-guardrail`,
      config: basicGuardrailConfig,
    });
  }

  createShortTermMemory(): agentcore.Memory {
    const name = `${getResourceNamePrefix()}-agentic-answers-memory`;

    return new agentcore.Memory(this, name, {
      // name cannot have dash characters
      memoryName: name.replaceAll('-', '_'),
      expirationDuration: cdk.Duration.days(365),
    });
  }

  agentcoreRuntime(
    shortTermMemoryId: string,
    guardrail: VersionedBedrockGuardrail,
    githubToken: string,
  ): agentcore.Runtime {
    const name = `${getResourceNamePrefix()}-agentic-answers-runtime`;

    const agentcoreRuntime = new agentcore.Runtime(this, name, {
      // runtime name cannot have dash characters
      runtimeName: name.replaceAll('-', '_'),
      agentRuntimeArtifact: this.agentCode(githubToken),
      environmentVariables: {
        BEDROCK_AGENTCORE_MEMORY_ID: shortTermMemoryId,
        GUARDRAIL_ID: guardrail.guardrailId,
        GUARDRAIL_VERSION: guardrail.guardrailVersion,
      },
    });

    agentcoreRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
          'arn:aws:bedrock:*::foundation-model/*',
        ],
      }),
    );

    agentcoreRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [guardrail.guardrailArn],
      }),
    );

    agentcoreRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:DeleteEvent',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:ListEvents',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/${shortTermMemoryId}`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/${shortTermMemoryId}/*`,
        ],
      }),
    );

    secretsmanager.Secret.fromSecretNameV2(
      this,
      'OpenSearchSecret',
      OPENSEARCH_SECRET_NAME,
    ).grantRead(agentcoreRuntime);

    return agentcoreRuntime;
  }

  agentCode(githubToken: string): agentcore.AgentRuntimeArtifact {
    return agentCoreCodeAsset({
      packageName: 'agentic-answers-agent',
      entrypoint: 'agentic_answers_agent/main.py',
      githubToken,
      extraDnfPackages: ['gcc', 'python3-devel', 'libjpeg-turbo-devel'],
    });
  }
}
