import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { getResourceNamePrefix, hashGlobs } from '../constants/environment.ts';

// You were about to look at fast glob for checking file mtime

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
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    helloWorldLambda.addPermission('AccountWideInvoke', {
      action: 'lambda:InvokeFunctionUrl',
      principal: new iam.AccountPrincipal(this.account),
    });

    new cdk.CfnOutput(this, 'LambdaUrl', {
      value: url.url,
    });
  }

  chatApiServerlessCode(): lambda.AssetCode {
    const assetHash = hashGlobs(
      '../services/chat-api-serverless/src/**/*.py',
      '../libs/python/**/src/**/*.py',
      '../uv.lock',
    );

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
          
          # Create a requirements.txt file of dependencies
          # Any editable dependencies are copied
          # Current project is not included
          # AWS bundled depenencies are excluded
          uv export --frozen \
                    --no-editable \
                    --no-dev \
                    --no-emit-project \
                    --package chat-api-serverless \
                    --prune botocore \
                    --prune boto3 \
                    -o /asset-output/requirements.txt &&

          # Install the requirements.txt
          # Compile bytecode for faster cold starts
          # Use a shared directory so faster for subsequent runs
          # Target appropriate Python platform and versions for any compilation
          # Use exact to remove any packages that shouldn't be installed
          # Use no-deps to only install what's in requirements.txt and not any 
          # sub-dependencies pip is aware of
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
