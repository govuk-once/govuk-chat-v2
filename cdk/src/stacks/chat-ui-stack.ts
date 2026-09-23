import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import {
  getResourceNamePrefix,
  isEphemeralEnvironment,
  repoRoot,
} from '../constants/environment.ts';

export interface ChatUiStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  environment: string;
}

const CONTAINER_PORT = 3000;

export class ChatUiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ChatUiStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const subnets = this.publicSubnets();
    const logGroup = this.logGroup();
    const service = this.expressService(props, subnets, logGroup);

    new cdk.CfnOutput(this, 'EndpointUrl', {
      value: service.attrEndpoint,
    });
  }

  // A VPC per developer stack, until the platform shared VPC can host
  // Express Mode tasks (CHAT-929 sub-issue 04).
  publicSubnets(): ec2.ISubnet[] {
    const vpcName = `${getResourceNamePrefix()}-chat-ui-vpc`;

    const vpc = new ec2.Vpc(this, vpcName, {
      vpcName,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
      ],
    });

    return vpc.publicSubnets;
  }

  logGroup(): logs.LogGroup {
    const logGroupName = `/ecs/express/${getResourceNamePrefix()}-chat-ui`;

    return new logs.LogGroup(this, logGroupName, {
      logGroupName,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
  }

  expressService(
    props: ChatUiStackProps,
    subnets: ec2.ISubnet[],
    logGroup: logs.LogGroup,
  ): ecs.CfnExpressGatewayService {
    const serviceName = `${getResourceNamePrefix()}-chat-ui`;

    // The Express Mode CloudFormation resource has no CPU architecture
    // property, so the task runs on x86.
    const image = new DockerImageAsset(this, `${serviceName}-image`, {
      directory: repoRoot(),
      file: 'services/chat-ui/Dockerfile',
      platform: Platform.LINUX_AMD64,
    });

    const executionRole = new iam.Role(this, `${serviceName}-execution-role`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    const infrastructureRole = new iam.Role(
      this,
      `${serviceName}-infrastructure-role`,
      {
        assumedBy: new iam.ServicePrincipal('ecs.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSInfrastructureRoleforExpressGatewayServices',
          ),
        ],
      },
    );

    const taskRole = new iam.Role(this, `${serviceName}-task-role`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const service = new ecs.CfnExpressGatewayService(this, serviceName, {
      serviceName,
      cpu: '512',
      memory: '1024',
      executionRoleArn: executionRole.roleArn,
      infrastructureRoleArn: infrastructureRole.roleArn,
      taskRoleArn: taskRole.roleArn,
      healthCheckPath: '/api/health',
      networkConfiguration: {
        subnets: subnets.map((subnet) => subnet.subnetId),
      },
      primaryContainer: {
        image: image.imageUri,
        containerPort: CONTAINER_PORT,
        environment: [{ name: 'ENVIRONMENT', value: props.environment }],
        awsLogsConfiguration: {
          logGroup: logGroup.logGroupName,
          logStreamPrefix: 'chat-ui',
        },
      },
      scalingTarget: {
        minTaskCount: 1,
        maxTaskCount: 1,
      },
    });

    service.node.addDependency(logGroup);
    service.node.addDependency(
      ...subnets.map((subnet) => subnet.internetConnectivityEstablished),
    );

    return service;
  }
}
