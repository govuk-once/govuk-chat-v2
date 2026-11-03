import { globSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getEnvironment, serviceMetadata } from '@govuk-chat-v2/environment';

export const GovUkOnceEnvironments = {
  Dev: 'dev',
  Test: 'test',
  Stag: 'stag',
  Prod: 'prod',
} as const;

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
  return prefix.slice(0, 40);
};

// generate a 5 character alphanumeric unique id
export const generateUniqueId = (): string => {
  return Math.random().toString(36).slice(2, 7);
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

export const repositoryRoot = () => {
  const filename = fileURLToPath(import.meta.url);

  // relative to the path of this current file
  return path.resolve(filename, '../../../../');
};
