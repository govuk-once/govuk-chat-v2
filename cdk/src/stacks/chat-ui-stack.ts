import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
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
  cognitoDomain: string;
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
    const sessionSecret = this.sessionSecret();
    const signInClient = this.signInClient(props);
    const service = this.expressService(
      props,
      subnets,
      logGroup,
      signInClient.ref,
      sessionSecret,
    );
    this.addEndpointCallbackUrls(props, signInClient, service);

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

  sessionSecret(): secretsmanager.Secret {
    const secretName = `${getResourceNamePrefix()}-chat-ui-session-secret`;

    return new secretsmanager.Secret(this, secretName, {
      secretName,
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
  }

  signInClient(props: ChatUiStackProps): cognito.CfnUserPoolClient {
    const clientName = `${getResourceNamePrefix()}-chat-ui-sign-in-client`;

    return new cognito.CfnUserPoolClient(this, clientName, {
      userPoolId: props.cognitoUserPoolId,
      clientName,
      generateSecret: true,
      allowedOAuthFlows: ['code'],
      allowedOAuthFlowsUserPoolClient: true,
      allowedOAuthScopes: ['openid'],
      supportedIdentityProviders: ['COGNITO'],
      callbackUrLs: ['http://localhost:3000/api/auth/callback/cognito'],
      logoutUrLs: ['http://localhost:3000/'],
    });
  }

  // The sign-in client and the service each reference the other (callback
  // URL ↔ client ID env var), which would be a circular dependency. The
  // client is created with only the localhost callback URL, then this
  // custom resource updates it to include the deployed endpoint after the
  // service exists.
  addEndpointCallbackUrls(
    props: ChatUiStackProps,
    signInClient: cognito.CfnUserPoolClient,
    service: ecs.CfnExpressGatewayService,
  ): void {
    const endpointUrl = (path: string): string =>
      cdk.Fn.join('', ['https://', service.attrEndpoint, path]);

    // UpdateUserPoolClient resets any setting it isn't given, so this repeats
    // the client's OAuth settings alongside the URLs.
    const updateCallbackUrls: cr.AwsSdkCall = {
      service: 'CognitoIdentityServiceProvider',
      action: 'updateUserPoolClient',
      parameters: {
        UserPoolId: props.cognitoUserPoolId,
        ClientId: signInClient.ref,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes: ['openid'],
        SupportedIdentityProviders: ['COGNITO'],
        CallbackURLs: [
          'http://localhost:3000/api/auth/callback/cognito',
          endpointUrl('/api/auth/callback/cognito'),
        ],
        LogoutURLs: ['http://localhost:3000/', endpointUrl('/')],
      },
      physicalResourceId: cr.PhysicalResourceId.of(
        'sign-in-client-callback-urls',
      ),
    };

    new cr.AwsCustomResource(this, 'SignInClientCallbackUrls', {
      onCreate: updateCallbackUrls,
      onUpdate: updateCallbackUrls,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPoolClient'],
          resources: [props.cognitoUserPoolArn],
        }),
      ]),
    });
  }

  expressService(
    props: ChatUiStackProps,
    subnets: ec2.ISubnet[],
    logGroup: logs.LogGroup,
    signInClientId: string,
    sessionSecret: secretsmanager.ISecret,
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

    sessionSecret.grantRead(executionRole);

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
          { name: 'COGNITO_DOMAIN', value: props.cognitoDomain },
          { name: 'COGNITO_TOKEN_ENDPOINT', value: props.cognitoTokenEndpoint },
          { name: 'COGNITO_USER_POOL_ID', value: props.cognitoUserPoolId },
          { name: 'COGNITO_APP_CLIENT_ID', value: props.cognitoAppClientId },
          { name: 'COGNITO_SIGN_IN_CLIENT_ID', value: signInClientId },
        ],
        secrets: [
          { name: 'SESSION_SECRET', valueFrom: sessionSecret.secretArn },
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
