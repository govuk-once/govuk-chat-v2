import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoots: string[] = [];

afterEach(() => {
  for (const root of packageRoots.splice(0)) {
    rmSync(root, { recursive: true });
  }
});

// Lays index.ts out as it is in the deployment package, beside a stand-in
// for the standalone server that prints the address it would listen on.
function deploymentPackage(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'demo-ui-package-'));
  packageRoots.push(root);
  copyFileSync(
    path.join(import.meta.dirname, 'index.ts'),
    path.join(root, 'index.ts'),
  );
  const serverDirectory = path.join(root, 'services/demo-ui');
  mkdirSync(serverDirectory, { recursive: true });
  writeFileSync(
    path.join(serverDirectory, 'server.js'),
    'console.log(`${process.env.HOSTNAME} ${process.env.PORT}`);',
  );
  return root;
}

describe('index.ts', () => {
  it('starts the server on the address Lambda gives', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(deploymentPackage(), 'index.ts')],
      {
        env: { ...process.env, AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:8080' },
        encoding: 'utf8',
      },
    );

    expect(output.trim()).toBe('127.0.0.1 8080');
  });
});
