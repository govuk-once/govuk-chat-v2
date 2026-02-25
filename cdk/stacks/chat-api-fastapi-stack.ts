import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as path from 'path';
import {
  getResourceNamePrefix,
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

    const fargate = new ecsPatterns.ApplicationLoadBalancedFargateService(
        this,
        `${getResourceNamePrefix()}-chat-api-fastapi`,
        {
            cpu: 512,
            memoryLimitMiB: 1024,
            desiredCount: 2,
            taskImageOptions: {
                image: ecs.ContainerImage.fromAsset(
                    repoRoot(),
                    {
                        file: 'services/chat-api-fastapi/Dockerfile',
                        exclude: ['*']
                    }
                ),
                containerPort: 8000,
            },
            publicLoadBalancer: true,
        }
    );

    new cdk.CfnOutput(this, 'StreamPath', {
      value: fargate.loadBalancer.loadBalancerDnsName,
    });
  }
}
