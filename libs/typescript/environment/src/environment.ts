// removed version for now as seems unlikely to be something incremented
// removed cost-centre for now until establish correct one and if other
// programme codes are needed
export const serviceMetadata = {
  serviceName: 'govuk-chat',
  teamName: 'chat-team',
  repositoryUrl: 'https://github.com/govuk-once/govuk-chat-v2',
};

export const getEnvironment = (): string => {
  const env = process.env.ENVIRONMENT || process.env.USER;
  if (!env) {
    throw new Error(
      'Unable to determine environment: Neither ENVIRONMENT nor USER environment variables are set',
    );
  }
  return env.replaceAll(/[^a-zA-Z0-9-]/g, '');
};
