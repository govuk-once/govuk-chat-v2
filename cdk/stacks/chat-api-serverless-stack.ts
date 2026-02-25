import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  getResourceNamePrefix,
  hashGlobs,
  repoRoot,
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

    const exampleLambda = new lambda.Function(
      this,
      `${getResourceNamePrefix()}-api-example`,
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'chat_api.handlers.example.lambda_handler',
        code: chatApiServerlessCode,
        architecture: lambda.Architecture.ARM_64,
      },
    );

    const streamLambda = new lambda.Function(
      this,
      `${getResourceNamePrefix()}-api-stream`,
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'chat_api.handlers.stream.lambda_handler',
        code: chatApiServerlessCode,
        architecture: lambda.Architecture.ARM_64,
      },
    );

    const api = new apigateway.RestApi(this, `${getResourceNamePrefix()}-api`, {
      deployOptions: {
        stageName: props.environment,
      },
    });

    const exampleIntegration = new apigateway.LambdaIntegration(exampleLambda);

    const exampleResource = api.root.addResource('example');
    exampleResource.addMethod('GET', exampleIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    const streamIntegration = new apigateway.LambdaIntegration(streamLambda, {
      responseTransferMode: apigateway.ResponseTransferMode.STREAM,
    });

    const streamResource = api.root.addResource('stream');
    streamResource.addMethod('GET', streamIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    new cdk.CfnOutput(this, 'ExamplePath', {
      value: `${api.url}example`,
    });

    new cdk.CfnOutput(this, 'StreamPath', {
      value: `${api.url}stream`,
    });
  }

  chatApiServerlessCode(): lambda.AssetCode {
    console.log(repoRoot());

    const assetHash = hashGlobs(
      path.resolve(repoRoot(), 'services/chat-api-serverless/src/**/*.py'),
      path.resolve(repoRoot(), 'libs/python/**/src/**/*.py'),
      path.resolve(repoRoot(), 'uv.lock'),
    );

    return lambda.Code.fromAsset(
      path.resolve(repoRoot(), 'services/chat-api-serverless/src'),
      {
        bundling: {
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
                'cdk/cache/pip/chat-api-serverless-packages',
              ),
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
      },
    );
  }
}
