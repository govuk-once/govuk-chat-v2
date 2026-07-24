import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import path from 'node:path';
import { Construct } from 'constructs';
import { getResourceNamePrefix, repoRoot } from '../constants/environment.ts';

export interface ChatApiTsStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
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

    // GET /v1/hello-world
    const helloWorld = api.root.addResource('v1').addResource('hello-world');
    helloWorld.addMethod('GET', helloWorldLambda);

    return api;
  }

  lambdaHandler(handlerPath: string): NodejsFunction {
    const nameSuffix = handlerPath.replaceAll(/[^a-zA-Z0-9-]/g, '-');
    const functionName = `${getResourceNamePrefix()}-chat-api-ts-${nameSuffix}`;

    return new NodejsFunction(this, functionName, {
      functionName: functionName,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      entry: path.resolve(
        repoRoot(),
        `services/chat-api-ts/src/handlers/${handlerPath}`,
      ),
      handler: 'handler',
    });
  }
}
