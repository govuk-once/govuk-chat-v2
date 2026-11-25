import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hashGlobs, repositoryRoot } from '../constants/environment.ts';

const ARCHIVE_NAME = 'code.zip';

// The package's entry shim, zipped at the root of the deployment package
// for the web function to start.
export const NEXTJS_ENTRY_POINT = 'index.ts';

function run(command: string, arguments_: string[], cwd: string): void {
  execFileSync(command, arguments_, { cwd, stdio: 'inherit' });
}

// Builds the package's standalone output with its scripts/build.sh, and
// zips it as the web function runs it: the package's index.ts at the root,
// starting the standalone server, which with outputFileTracingRoot at the
// repo root keeps the workspace layout under it.
function bundleStandalone(servicePath: string, outputDirectory: string): void {
  const packageDirectory = path.resolve(repositoryRoot(), servicePath);
  const archive = path.join(outputDirectory, ARCHIVE_NAME);
  const standaloneDirectory = path.join(packageDirectory, '.next/standalone');

  run('scripts/build.sh', [], packageDirectory);
  // -y stores pnpm's symlinks as symlinks: following them would copy each
  // package away from the dependencies it resolves beside.
  run('zip', ['-qry', archive, '.'], standaloneDirectory);
  run('zip', ['-qr', archive, `${servicePath}/.next/static`], repositoryRoot());
  run('zip', ['-q', archive, NEXTJS_ENTRY_POINT], packageDirectory);
}

function sourceHash(packageDirectory: string): string {
  return hashGlobs(
    path.join(packageDirectory, 'src/**/*'),
    path.join(
      packageDirectory,
      `{${NEXTJS_ENTRY_POINT},next.config.ts,package.json}`,
    ),
    path.join(repositoryRoot(), 'pnpm-lock.yaml'),
  );
}

// Next.js builds on the host rather than in a container, as the build has
// no native dependencies, and it needs the workspace's dependencies, which
// pnpm has already installed there.
export function nextjsWebFunctionCode(
  packageName: string,
): lambda.WebFunctionCode {
  const servicePath = `services/${packageName}`;
  const packageDirectory = path.resolve(repositoryRoot(), servicePath);

  return lambda.WebFunctionCode.fromAssetToManagedBucket(packageDirectory, {
    assetHashType: cdk.AssetHashType.CUSTOM,
    assetHash: sourceHash(packageDirectory),
    bundling: {
      // Never used, as local bundling either bundles or throws, but the
      // bundling options require an image.
      image: lambda.Runtime.NODEJS_24_X.bundlingImage,
      outputType: cdk.BundlingOutput.ARCHIVED,
      local: {
        tryBundle(outputDirectory: string): boolean {
          bundleStandalone(servicePath, outputDirectory);
          return true;
        },
      },
    },
  });
}
