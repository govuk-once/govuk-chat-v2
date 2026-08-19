import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import path from 'node:path';
import { hashGlobs, repoRoot } from '../constants/environment.ts';

interface AgentCoreCodeAssetOptions {
  packageName: string;
  entrypoint: string;
  githubToken: string;
  extraDnfPackages?: string[];
}

export function agentCoreCodeAsset(
  options: AgentCoreCodeAssetOptions,
): agentcore.AgentRuntimeArtifact {
  const {
    packageName,
    entrypoint,
    githubToken,
    extraDnfPackages = [],
  } = options;
  const servicePath = `services/${packageName}`;
  const dnfPackages = ['git', 'zip', ...extraDnfPackages];

  const assetHash = hashGlobs(
    path.resolve(repoRoot(), `${servicePath}/src/**/*.py`),
    path.resolve(repoRoot(), 'uv.lock'),
  );

  return agentcore.AgentRuntimeArtifact.fromCodeAsset({
    path: path.resolve(repoRoot(), servicePath),
    runtime: agentcore.AgentCoreRuntime.PYTHON_3_13,
    entrypoint: ['opentelemetry-instrument', entrypoint],
    bundling: {
      image: lambda.Runtime.PYTHON_3_13.bundlingImage,
      volumes: [
        {
          containerPath: '/repo-root',
          hostPath: repoRoot(),
        },
        {
          containerPath: '/pip-cache/global-cache',
          hostPath: path.resolve(repoRoot(), 'cdk/cache/pip/global-cache'),
        },
        {
          containerPath: '/pip-cache/packages',
          hostPath: path.resolve(
            repoRoot(),
            `cdk/cache/pip/${packageName}-packages`,
          ),
        },
      ],
      environment: {
        GITHUB_TOKEN: githubToken,
      },
      outputType: cdk.BundlingOutput.ARCHIVED,
      command: [
        'bash',
        '-c',
        `
        SECONDS=0 &&
        dnf install -y ${dnfPackages.join(' ')} &&
        pip install uv==0.10.2 --root-user-action=ignore --cache-dir=/pip-cache/global-cache &&
        git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" &&

        mkdir /tmp/bundle &&

        cd /repo-root &&

        uv export --frozen \
                  --no-editable \
                  --no-dev \
                  --no-emit-project \
                  --package ${packageName} \
                  -o /tmp/bundle/requirements.txt &&

        uv pip install --no-installer-metadata \
                        --link-mode=copy \
                        --target /pip-cache/packages \
                        --python-platform aarch64-manylinux_2_28 \
                        --python-version 3.13 \
                        --exact \
                        --no-deps \
                        --cache-dir=/pip-cache/global-cache \
                        -r /tmp/bundle/requirements.txt &&

        # Write files to a zip to have a single file output rather
        # than hundreds, this reduces time in CDK validation
        cd /pip-cache/packages && zip -qr /asset-output/code.zip . &&
        cd /asset-input/src && zip -qur /asset-output/code.zip . &&

        echo "Asset bundling complete in $SECONDS seconds"
        `,
      ],
      user: 'root',
    },
    assetHashType: cdk.AssetHashType.CUSTOM,
    assetHash: assetHash,
  });
}
