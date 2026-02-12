import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import {
  getResourceNamePrefix,
  mostRecentFileMtime,
  sha256Hash,
} from '../constants/environment.ts';

export interface ChatApiServerlessStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  environment: string;
}

export class ChatApiServerlessStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ChatApiServerlessStackProps,
  ) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const chatApiServerlessCode = this.chatApiServerlessCode();

    const helloWorldLambda = new lambda.Function(
      this,
      `${getResourceNamePrefix()}-api-hello-world`,
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'chat_api.handlers.hello_world.lambda_handler',
        code: chatApiServerlessCode,
        architecture: lambda.Architecture.ARM_64,
      },
    );

    const url = helloWorldLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // helloWorldLambda.addPermission('AccountWideInvoke', {
    //   action: 'lambda:InvokeFunctionUrl',
    //   principal: new iam.AccountPrincipal(this.account),
    // });

    new cdk.CfnOutput(this, 'LambdaUrl', {
      value: url.url,
    });
  }

  chatApiServerlessCode(): lambda.AssetCode {
    const mtime = mostRecentFileMtime(
      '../services/chat-api-serverless/src/**/*.py',
      '../libs/python/**/src/**/*.py',
      '../uv.lock',
    );
    const assetHash = sha256Hash(mtime.toString());

    return lambda.Code.fromAsset('../services/chat-api-serverless/src', {
      bundling: {
        image: lambda.Runtime.PYTHON_3_13.bundlingImage,
        volumes: [
          {
            containerPath: '/repo-root',
            hostPath: '../',
          },
          // cache for all pip dependencies
          {
            containerPath: '/pip-cache/global-cache',
            hostPath: './cache/pip/global-cache',
          },
          // cache for this asset
          {
            containerPath: '/pip-cache/packages',
            hostPath: './cache/pip/chat-api-serverless-packages',
          },
        ],
        command: [
          'bash',
          '-c',
          `
          pip install uv==0.10.2 --root-user-action=ignore --cache-dir=/pip-cache/global-cache &&
          cp -r /asset-input/* /asset-output/ &&
          cd /repo-root &&
          uv export --frozen \
                    --no-editable \
                    --no-dev \
                    --no-emit-project \
                    --package chat-api-serverless \
                    --prune botocore \
                    --prune boto3 \
                    -o /asset-output/requirements.txt &&
          uv pip install --no-installer-metadata \
                         --compile-bytecode \
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
