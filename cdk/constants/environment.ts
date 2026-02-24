import { globSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'url';
import * as path from 'path';

export const GovUkOnceEnvironments = {
  Dev: 'dev',
  Test: 'test',
  Stag: 'stag',
  Prod: 'prod',
} as const;

// removed version for now as seems unlikely to be something incremented
// removed cost-centre for now until establish correct one and if other
// programme codes are needed
export const serviceMetadata = {
  serviceName: 'govuk-chat',
  teamName: 'chat-team',
  repositoryUrl: 'https://github.com/govuk-once/govuk-chat-v2-prototype',
};

export const getEnvironment = (): string => {
  const env = process.env.ENVIRONMENT || process.env.USER;
  if (!env) {
    throw new Error(
      'Unable to determine environment: Neither ENVIRONMENT nor USER environment variables are set',
    );
  }
  return env.replace(/[^a-zA-Z0-9-]/g, '');
};

export const isEphemeralEnvironment = (): boolean => {
  const environment = getEnvironment();
  const nonEphemeral: string[] = [
    GovUkOnceEnvironments.Stag,
    GovUkOnceEnvironments.Prod,
  ];
  return !nonEphemeral.includes(environment);
};

export const getResourceNamePrefix = (): string => {
  const environment = getEnvironment();
  const prefix = `${environment}-${serviceMetadata.serviceName}`.toLowerCase();
  return prefix.substring(0, 40);
};

// generate a 5 character alphanumeric unique id
export const generateUniqueId = (): string => {
  return Math.random().toString(36).substring(2, 7);
};

export const hashGlobs = (...pathGlobs: string[]): string => {
  const files = pathGlobs.flatMap((glob) => globSync(glob));
  const filenamesWithMtime = files.map(
    (file) => `${file}-${statSync(file).mtimeMs}`,
  );

  const hash = createHash('sha256');

  for (const id of filenamesWithMtime) {
    hash.update(id, 'utf8');
  }

  return hash.digest('hex');
};

export const repoRoot = () => {
  const filename = fileURLToPath(import.meta.url);

  // relative to the path of this current file
  return path.resolve(filename, '../../../');
};
