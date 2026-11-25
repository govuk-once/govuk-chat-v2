import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { nextjsWebFunctionCode } from '../bundling/nextjs.ts';
import {
  getResourceNamePrefix,
  isEphemeralEnvironment,
} from '../constants/environment.ts';

export interface DemoUiStackProps extends cdk.StackProps {
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

// Long enough to stream a reply from the Chat API, whose Lambda times out
// after 30 seconds.
const WEB_FUNCTION_TIMEOUT = cdk.Duration.seconds(60);
const LOCAL_DEV_ORIGIN = 'http://localhost:3000';

export class DemoUiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DemoUiStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Environment', props.environment);

    const logGroup = this.logGroup();
    const sessionSecret = this.sessionSecret();
    const signInClient = this.signInClient(props);
    const webFunction = this.webFunction(
      props,
      logGroup,
      signInClient.ref,
      sessionSecret,
    );
    const endpointUrl = `https://${webFunction.endpoint.domainName}`;
    this.applySignInClientSettings(props, signInClient, endpointUrl);

    new cdk.CfnOutput(this, 'EndpointUrl', { value: endpointUrl });

    new cdk.CfnOutput(this, 'SignInClientId', {
      value: signInClient.ref,
    });
  }

  logGroup(): logs.LogGroup {
    const logGroupName = `/aws/lambda/${getResourceNamePrefix()}-demo-ui`;

    return new logs.LogGroup(this, logGroupName, {
      logGroupName,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
  }

  sessionSecret(): secretsmanager.Secret {
    const secretName = `${getResourceNamePrefix()}-demo-ui-session-secret`;

    return new secretsmanager.Secret(this, secretName, {
      secretName,
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
  }

  // Its settings are applied by applySignInClientSettings, not here.
  signInClient(props: DemoUiStackProps): cognito.CfnUserPoolClient {
    const clientName = `${getResourceNamePrefix()}-demo-ui-sign-in-client`;

    return new cognito.CfnUserPoolClient(this, clientName, {
      userPoolId: props.cognitoUserPoolId,
      clientName,
      generateSecret: true,
    });
  }

  // The sign-in client needs the web function's endpoint as a callback URL,
  // and the web function needs the client's ID, which would be a circular
  // dependency. So this custom resource applies the client's settings once
  // the endpoint exists.
  //
  // UpdateUserPoolClient resets any setting it isn't given, as would
  // CloudFormation updating the client, so every setting lives here rather
  // than on the client. Any change CloudFormation can make to the client
  // either replaces it or renames it, and both change this call, so it runs
  // again.
  applySignInClientSettings(
    props: DemoUiStackProps,
    signInClient: cognito.CfnUserPoolClient,
    endpointUrl: string,
  ): void {
    const origins = [
      ...(isEphemeralEnvironment() ? [LOCAL_DEV_ORIGIN] : []),
      endpointUrl,
    ];

    const updateSignInClient: cr.AwsSdkCall = {
      service: 'CognitoIdentityServiceProvider',
      action: 'updateUserPoolClient',
      parameters: {
        UserPoolId: props.cognitoUserPoolId,
        ClientId: signInClient.ref,
        ClientName: signInClient.clientName,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes: ['openid'],
        SupportedIdentityProviders: ['COGNITO'],
        CallbackURLs: origins.map((origin) => `${origin}/api/auth/callback`),
        LogoutURLs: origins.map((origin) => `${origin}/`),
        PreventUserExistenceErrors: 'ENABLED',
      },
      physicalResourceId: cr.PhysicalResourceId.of('sign-in-client-settings'),
      // The response includes the client secret, so keep it out of the
      // custom resource's logs and the data it returns to CloudFormation.
      logging: cr.Logging.withDataHidden(),
      outputPaths: ['UserPoolClient.ClientId'],
    };

    new cr.AwsCustomResource(this, 'SignInClientSettings', {
      onCreate: updateSignInClient,
      onUpdate: updateSignInClient,
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPoolClient'],
          resources: [props.cognitoUserPoolArn],
        }),
      ]),
    });
  }

  webFunction(
    props: DemoUiStackProps,
    logGroup: logs.LogGroup,
    signInClientId: string,
    sessionSecret: secretsmanager.ISecret,
  ): lambda.WebFunction {
    const webFunctionName = `${getResourceNamePrefix()}-demo-ui`;

    // Changing the construct ID or the name replaces the web function, and
    // with it the endpoint's URL.
    const webFunction = new lambda.WebFunction(this, webFunctionName, {
      webFunctionName,
      runtime: lambda.WebFunctionRuntime.NODEJS_24_X,
      code: nextjsWebFunctionCode('demo-ui'),
      defaultEndpointAuth: lambda.WebFunctionAuthType.APPLICATION_MANAGED,
      timeout: WEB_FUNCTION_TIMEOUT,
      logGroup,
      environment: {
        ENVIRONMENT: props.environment,
        CHAT_API_URL: props.chatApiUrl,
        COGNITO_TOKEN_ENDPOINT: props.cognitoTokenEndpoint,
        COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
        COGNITO_APP_CLIENT_ID: props.cognitoAppClientId,
        COGNITO_SIGN_IN_CLIENT_ID: signInClientId,
        SESSION_SECRET_ARN: sessionSecret.secretArn,
      },
    });

    cdk.Annotations.of(webFunction.endpoint).acknowledgeWarning(
      '@aws-cdk/aws-lambda:webFunctionPublicEndpoint',
      'The endpoint is public, as the app requires Cognito sign-in itself',
    );

    // The app reads the Chat API client secret from Cognito, rather than
    // holding a copy of it.
    webFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:DescribeUserPoolClient'],
        resources: [props.cognitoUserPoolArn],
      }),
    );
    sessionSecret.grantRead(webFunction);

    return webFunction;
  }
}
