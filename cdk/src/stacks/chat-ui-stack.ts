import * as crypto from 'node:crypto';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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
  chatApiUrl: string;
  cognitoTokenEndpoint: string;
  cognitoUserPoolId: string;
  cognitoUserPoolArn: string;
  cognitoAppClientId: string;
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
    const sessionSecret = crypto.randomUUID();
    const signInClient = this.signInClient(props);
    const service = this.expressService(
      props,
      subnets,
      logGroup,
      signInClient.ref,
      sessionSecret,
    );

    new cdk.CfnOutput(this, 'EndpointUrl', {
      value: service.attrEndpoint,
    });

    new cdk.CfnOutput(this, 'SignInClientId', {
      value: signInClient.ref,
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

  signInClient(props: ChatUiStackProps): cognito.CfnUserPoolClient {
    const clientName = `${getResourceNamePrefix()}-chat-ui-sign-in-client`;

    // Only localhost for now; the deployed endpoint's callback URL is
    // added by the deploy script after the service is created. A
    // CloudFormation-level circular reference prevents wiring the
    // endpoint URL here.
    return new cognito.CfnUserPoolClient(this, clientName, {
      userPoolId: props.cognitoUserPoolId,
      clientName,
      generateSecret: true,
      allowedOAuthFlows: ['code'],
      allowedOAuthFlowsUserPoolClient: true,
      allowedOAuthScopes: ['openid'],
      supportedIdentityProviders: ['COGNITO'],
      callbackUrLs: ['http://localhost:3000/api/auth/callback'],
      logoutUrLs: ['http://localhost:3000/'],
      idTokenValidity: isEphemeralEnvironment() ? 1440 : 60,
      tokenValidityUnits: { idToken: 'minutes' },
    });
  }

  expressService(
    props: ChatUiStackProps,
    subnets: ec2.ISubnet[],
    logGroup: logs.LogGroup,
    signInClientId: string,
    sessionSecret: string,
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

    // The app reads the Chat API client secret from Cognito, rather than
    // holding a copy of it.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:DescribeUserPoolClient'],
        resources: [props.cognitoUserPoolArn],
      }),
    );

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
        environment: [
          { name: 'ENVIRONMENT', value: props.environment },
          { name: 'CHAT_API_URL', value: props.chatApiUrl },
          { name: 'COGNITO_TOKEN_ENDPOINT', value: props.cognitoTokenEndpoint },
          { name: 'COGNITO_USER_POOL_ID', value: props.cognitoUserPoolId },
          { name: 'COGNITO_APP_CLIENT_ID', value: props.cognitoAppClientId },
          { name: 'COGNITO_SIGN_IN_CLIENT_ID', value: signInClientId },
          { name: 'SESSION_SECRET', value: sessionSecret },
        ],
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
