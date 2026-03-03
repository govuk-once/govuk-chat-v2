import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  getResourceNamePrefix,
  hashGlobs,
  repoRoot,
} from '../constants/environment.ts';

export interface ChatApiFastapiStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  environment: string;
}

export class ChatApiFastapiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ChatApiFastapiStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const chatApiFastapiCode = this.chatApiFastapiCode();

    const apiLambda = new lambda.Function(
      this,
      `${getResourceNamePrefix()}-api-fastapi-function`,
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'lambda-run.sh',
        code: chatApiFastapiCode,
        architecture: lambda.Architecture.ARM_64,
        environment: {
          AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
          AWS_LWA_INVOKE_MODE: 'RESPONSE_STREAM',
          PORT: '8000',
        },
        timeout: cdk.Duration.minutes(15),
        layers: [
          lambda.LayerVersion.fromLayerVersionArn(
            this,
            'LambdaWebAdapterLayer',
            `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerArm64:26`,
          ),
        ],
      },
    );

    this.bedrockPermissions(apiLambda);

    const api = new apigateway.LambdaRestApi(
      this,
      `${getResourceNamePrefix()}-api-fastapi-gateway`,
      {
        proxy: true,
        handler: apiLambda,
        integrationOptions: {
          responseTransferMode: apigateway.ResponseTransferMode.STREAM,
          timeout: cdk.Duration.minutes(15),
        },
        defaultMethodOptions: {
          authorizationType: apigateway.AuthorizationType.IAM,
        },
        deployOptions: {
          stageName: props.environment,
        },
      },
    );

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: api.url,
    });
  }

  bedrockPermissions(func: lambda.Function) {
    func.addToRolePolicy(
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
  }

  chatApiFastapiCode(): lambda.AssetCode {
    const assetHash = hashGlobs(
      path.resolve(repoRoot(), 'services/chat-api-fastapi/src/**/*.py'),
      path.resolve(repoRoot(), 'libs/python/**/src/**/*.py'),
      path.resolve(repoRoot(), 'uv.lock'),
    );

    return lambda.Code.fromAsset(
      path.resolve(repoRoot(), 'services/chat-api-fastapi'),
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
                'cdk/cache/pip/chat-api-fastapi-packages',
              ),
            },
          ],
          command: [
            'bash',
            '-c',
            `
          pip install uv==0.10.2 --root-user-action=ignore --cache-dir=/pip-cache/global-cache &&

          cp -r /asset-input/src/* /asset-output/ &&
          cp -r /asset-input/scripts/lambda-run.sh /asset-output/ &&

          cd /repo-root &&
          
          # Create a requirements.txt file of dependencies
          # Any editable dependencies are copied
          # Current project is not included
          # AWS bundled depenencies are excluded
          uv export --frozen \
                    --no-editable \
                    --no-dev \
                    --no-emit-project \
                    --package chat-api-fastapi \
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
