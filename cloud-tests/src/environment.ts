import {
  CloudFormationClient,
  paginateDescribeStacks,
  type Stack,
} from '@aws-sdk/client-cloudformation';

// These match how cdk/src/constants/environment.ts names the environment and
// the service it tags every stack with. If they drift apart, no stacks are
// found and the tests fail naming the environment they looked for.
const SERVICE_NAME = 'govuk-chat';

export const environmentName = (): string => {
  const environment = process.env.ENVIRONMENT || process.env.USER;
  if (!environment) {
    throw new Error('Set ENVIRONMENT or USER to the environment to test');
  }
  return environment.replaceAll(/[^a-zA-Z0-9-]/g, '');
};

export interface ChatApiOutputs {
  gatewayUrl: string;
  tokenEndpoint: string;
  userPoolId: string;
  appClientId: string;
}

const hasTag = (stack: Stack, key: string, value: string): boolean =>
  stack.Tags?.some((tag) => tag.Key === key && tag.Value === value) ?? false;

async function findEnvironmentStacks(environment: string): Promise<Stack[]> {
  const client = new CloudFormationClient({});
  const pages = paginateDescribeStacks({ client }, {});
  const stacks: Stack[] = [];

  for await (const page of pages) {
    const matching = (page.Stacks ?? []).filter(
      (stack) =>
        hasTag(stack, 'Environment', environment) &&
        hasTag(stack, 'ServiceName', SERVICE_NAME),
    );
    stacks.push(...matching);
  }

  if (stacks.length === 0) {
    throw new Error(
      `No ${SERVICE_NAME} stacks found for environment "${environment}"`,
    );
  }
  return stacks;
}

async function stackOutputs<Key extends string>(
  stackId: string,
  outputKeys: readonly Key[],
): Promise<Record<Key, string>> {
  const environment = environmentName();
  const stacks = await findEnvironmentStacks(environment);
  const stack = stacks.find((candidate) =>
    candidate.StackName?.endsWith(`-${stackId}`),
  );
  if (!stack) {
    throw new Error(`No ${stackId} found for environment "${environment}"`);
  }

  const outputs = {} as Record<Key, string>;
  for (const key of outputKeys) {
    const value = stack.Outputs?.find(
      (output) => output.OutputKey === key,
    )?.OutputValue;
    if (!value) {
      throw new Error(
        `${stack.StackName} has no ${key} output; it may not have finished deploying`,
      );
    }
    outputs[key] = value;
  }
  return outputs;
}

export async function chatApiOutputs(): Promise<ChatApiOutputs> {
  const outputs = await stackOutputs('ChatApiStack', [
    'GatewayUrl',
    'TokenEndpoint',
    'UserPoolId',
    'AppClientId',
  ]);
  return {
    gatewayUrl: outputs.GatewayUrl,
    tokenEndpoint: outputs.TokenEndpoint,
    userPoolId: outputs.UserPoolId,
    appClientId: outputs.AppClientId,
  };
}
