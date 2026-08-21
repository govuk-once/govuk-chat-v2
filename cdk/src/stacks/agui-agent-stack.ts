import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { agentCoreCodeAsset } from '../bundling/python.ts';
import { getResourceNamePrefix } from '../constants/environment.ts';

export interface AguiAgentStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  environment: string;
  githubToken: string;
}

export class AguiAgentStack extends cdk.Stack {
  public readonly agentRuntimeArn: string;

  constructor(scope: Construct, id: string, props: AguiAgentStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const shortTermMemory = this.createShortTermMemory();
    const runtime = this.agentcoreRuntime(
      shortTermMemory.memoryId,
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
  }

  createShortTermMemory(): agentcore.Memory {
    const name = `${getResourceNamePrefix()}-agui-memory`;

    return new agentcore.Memory(this, name, {
      // name cannot have dash characters
      memoryName: name.replaceAll('-', '_'),
      expirationDuration: cdk.Duration.days(90),
    });
  }

  agentcoreRuntime(
    shortTermMemoryId: string,
    githubToken: string,
  ): agentcore.Runtime {
    const name = `${getResourceNamePrefix()}-agui-agent-runtime`;

    const agentcoreRuntime = new agentcore.Runtime(this, name, {
      // runtime name cannot have dash characters
      runtimeName: name.replaceAll('-', '_'),
      agentRuntimeArtifact: this.agentCode(githubToken),
      environmentVariables: {
        BEDROCK_AGENTCORE_MEMORY_ID: shortTermMemoryId,
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
        actions: [
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:ListEvents',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/${shortTermMemoryId}`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/${shortTermMemoryId}/*`,
        ],
      }),
    );

    return agentcoreRuntime;
  }

  agentCode(githubToken: string): agentcore.AgentRuntimeArtifact {
    return agentCoreCodeAsset({
      packageName: 'agui-agent',
      entrypoint: 'agui_agent/main.py',
      githubToken,
      extraDnfPackages: ['gcc', 'python3-devel', 'libjpeg-turbo-devel'],
    });
  }
}
