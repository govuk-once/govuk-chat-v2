import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pnpm hoists dependencies to the workspace root, so the standalone output
  // has to trace files from there rather than from this package.
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  // Otherwise `next dev` writes its own AGENTS.md and CLAUDE.md into this
  // package; agent guidance for the repo lives in the root AGENTS.md.
  agentRules: false,
};

export default nextConfig;
