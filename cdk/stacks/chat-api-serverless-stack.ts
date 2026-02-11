import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

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
  }
}
