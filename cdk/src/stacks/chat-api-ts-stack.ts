import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import path from 'node:path';
import { Construct } from 'constructs';
import { getResourceNamePrefix, repoRoot } from '../constants/environment.ts';

export interface ChatApiTsStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  agentRuntimeArn: string;
  repositoryUrl: string;
  environment: string;
}

export class ChatApiTsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ChatApiTsStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const apiGateway = this.apiGateway(props);

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: apiGateway.url,
    });
  }

  apiGateway(props: ChatApiTsStackProps): apigateway.RestApi {
    const api = new apigateway.RestApi(
      this,
      `${getResourceNamePrefix()}-chat-api-ts-gateway`,
      {
        restApiName: `${getResourceNamePrefix()}-chat-api-ts-gateway`,
        deployOptions: {
          stageName: props.environment,
        },
        defaultMethodOptions: {
          authorizationType: apigateway.AuthorizationType.IAM,
        },
      },
    );

    const helloWorldLambda = new apigateway.LambdaIntegration(
      this.lambdaHandler('hello-world.ts'),
    );

    const agentStreamFunction = this.lambdaHandler('threads/invoke.ts', {
      AGENT_RUNTIME_ARN: props.agentRuntimeArn,
    });

    agentStreamFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          // AgentCore requires both the base runtime ARN and a wildcard for sub-paths
          // (e.g. /runtime-endpoint/DEFAULT).
          props.agentRuntimeArn,
          `${props.agentRuntimeArn}/*`,
        ],
      }),
    );

    const agentStreamLambda = new apigateway.LambdaIntegration(
      agentStreamFunction,
      {
        responseTransferMode: apigateway.ResponseTransferMode.STREAM,
      },
    );

    const v1 = api.root.addResource('v1');

    // TODO: Remove hello-world endpoint once threads invoke endpoint
    // is merged.
    // GET /v1/hello-world
    const helloWorld = v1.addResource('hello-world');
    helloWorld.addMethod('GET', helloWorldLambda);

    // POST /v1/threads/invoke
    const agentStream = v1.addResource('threads').addResource('invoke');
    agentStream.addMethod('POST', agentStreamLambda);

    return api;
  }

  lambdaHandler(
    handlerPath: string,
    environment?: { [key: string]: string },
  ): NodejsFunction {
    const nameSuffix = handlerPath.replaceAll(/[^a-zA-Z0-9-]/g, '-');
    const functionName = `${getResourceNamePrefix()}-chat-api-ts-${nameSuffix}`;

    return new NodejsFunction(this, functionName, {
      functionName: functionName,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      environment: environment,
      entry: path.resolve(
        repoRoot(),
        `services/chat-api-ts/src/handlers/${handlerPath}`,
      ),
      handler: 'handler',
    });
  }
}
