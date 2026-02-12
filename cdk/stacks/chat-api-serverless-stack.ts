import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { getResourceNamePrefix } from '../constants/environment.ts';

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

    const helloWorldLambda = new lambda.Function(
      this,
      `${getResourceNamePrefix()}-api-hello-world`,
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'chat_api.handlers.hello_world.lambda_handler',
        code: lambda.Code.fromAsset('../services/chat-api-serverless/src', {
          bundling: {
            image: lambda.Runtime.PYTHON_3_13.bundlingImage,
            volumes: [
              {
                containerPath: '/repo-root',
                hostPath: '../',
              },
            ],
            command: [
              'bash',
              '-c',
              `
              pip install uv --root-user-action=ignore &&
              cp -r /asset-input/* /asset-output/ &&
              cd /repo-root &&
              uv export --frozen --no-editable --no-dev --no-emit-project --package chat-api-serverless -o requirements.txt &&
              uv pip install --no-installer-metadata --no-compile-bytecode --link-mode=copy --target /asset-output/packages -r requirements.txt
              `,
            ],
            user: 'root',
          },
        }),
      },
    );

    const url = helloWorldLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // helloWorldLambda.addPermission('AccountWideInvoke', {
    //   action: 'lambda:InvokeFunctionUrl',
    //   principal: new iam.AccountPrincipal(this.account),
    // });

    new cdk.CfnOutput(this, 'LambdaUrl', {
      value: url.url,
    });
  }
}
