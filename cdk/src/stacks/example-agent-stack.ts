import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import { Construct } from 'constructs';
import {
  getResourceNamePrefix,
  hashGlobs,
  repoRoot,
} from '../constants/environment.ts';

export interface ExampleAgentStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  environment: string;
  githubToken: string;
}

export class ExampleAgentStack extends cdk.Stack {
  public readonly agentRuntimeArn: string;

  constructor(scope: Construct, id: string, props: ExampleAgentStackProps) {
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

    new cdk.CfnOutput(this, 'ShortTermMemoryId', {
      value: shortTermMemory.memoryId,
    });
  }

  createShortTermMemory(): agentcore.Memory {
    const name = `${getResourceNamePrefix()}-example-memory`;

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
    const name = `${getResourceNamePrefix()}-example-agent-runtime`;

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
    const assetHash = hashGlobs(
      path.resolve(repoRoot(), 'services/example-agent/src/**/*.py'),
      path.resolve(repoRoot(), 'uv.lock'),
    );

    return agentcore.AgentRuntimeArtifact.fromCodeAsset({
      path: path.resolve(repoRoot(), 'services/example-agent'),
      runtime: agentcore.AgentCoreRuntime.PYTHON_3_13,
      entrypoint: ['opentelemetry-instrument', 'example_agent/main.py'],
      bundling: {
        // there aren't agentcore bundling images, so I think a Lambda one
        // will be ok
        image: lambda.Runtime.PYTHON_3_13.bundlingImage,
        volumes: [
          {
            containerPath: '/repo-root',
            hostPath: repoRoot(),
          },
          // cache for all pip dependencies
          {
            containerPath: '/pip-cache/global-cache',
            hostPath: path.resolve(repoRoot(), 'cdk/cache/pip/global-cache'),
          },
          // cache for this asset
          {
            containerPath: '/pip-cache/packages',
            hostPath: path.resolve(
              repoRoot(),
              'cdk/cache/pip/example-agent-packages',
            ),
          },
        ],
        environment: {
          GITHUB_TOKEN: githubToken,
        },
        command: [
          'bash',
          '-c',
          `
        dnf install -y git &&
        pip install uv==0.10.2 --root-user-action=ignore --cache-dir=/pip-cache/global-cache &&
        git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" &&

        cp -r /asset-input/src/* /asset-output/ &&

        cd /repo-root &&

        # Create a requirements.txt file of dependencies
        # Any editable dependencies are copied
        # Current project is not included
        uv export --frozen \
                  --no-editable \
                  --no-dev \
                  --no-emit-project \
                  --package example-agent \
                  -o /asset-output/requirements.txt &&

        # Install the requirements.txt
        # Use a shared directory so faster for subsequent runs
        # Target appropriate Python platform and versions for any compilation
        # Use exact to remove any packages that shouldn't be installed
        # Use no-deps to only install what's in requirements.txt and not any
        # sub-dependencies pip is aware of
        uv pip install --no-installer-metadata \
                        --link-mode=copy \
                        --target /pip-cache/packages \
                        --python-platform aarch64-manylinux2014 \
                        --python-version 3.13 \
                        --exact \
                        --no-deps \
                        --cache-dir=/pip-cache/global-cache \
                        -r /asset-output/requirements.txt &&

        cp -r /pip-cache/packages/* /asset-output/
        `,
        ],
        user: 'root',
      },
      assetHashType: cdk.AssetHashType.CUSTOM,
      assetHash: assetHash,
    });
  }
}
