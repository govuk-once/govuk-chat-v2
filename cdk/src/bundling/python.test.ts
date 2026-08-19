import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { describe, it, expect, vi } from 'vitest';
import { agentCoreCodeAsset } from './python.ts';

describe('agentCoreCodeAsset', () => {
  const baseOptions = {
    packageName: 'my-agent',
    entrypoint: 'my_agent/main.py',
    githubToken: 'test-token',
  };

  it('returns an AgentRuntimeArtifact', () => {
    const result = agentCoreCodeAsset(baseOptions);

    expect(result).toBeInstanceOf(agentcore.AgentRuntimeArtifact);
  });

  it('includes extra dnf packages in the install command', () => {
    const fromCodeAssetSpy = vi.spyOn(
      agentcore.AgentRuntimeArtifact,
      'fromCodeAsset',
    );

    agentCoreCodeAsset({
      ...baseOptions,
      extraDnfPackages: ['gcc', 'python3-devel'],
    });

    expect(fromCodeAssetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bundling: expect.objectContaining({
          command: expect.arrayContaining([
            expect.stringContaining('dnf install -y git zip gcc python3-devel'),
          ]),
        }),
      }),
    );
  });
});
