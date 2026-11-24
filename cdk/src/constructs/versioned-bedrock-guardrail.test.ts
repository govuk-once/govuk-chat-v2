import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  type BedrockGuardrailConfig,
  VersionedBedrockGuardrail,
} from './versioned-bedrock-guardrail.ts';

const config: BedrockGuardrailConfig = {
  blockedInputMessaging: 'Input blocked',
  blockedOutputsMessaging: 'Output blocked',
};

function versionDescription(guardrailConfig: BedrockGuardrailConfig): string {
  const stack = new cdk.Stack();
  new VersionedBedrockGuardrail(stack, 'Guardrail', {
    name: 'test-guardrail',
    config: guardrailConfig,
  });
  const [version] = Object.values(
    Template.fromStack(stack).findResources('AWS::Bedrock::GuardrailVersion'),
  );
  return version.Properties.Description;
}

describe('VersionedBedrockGuardrail', () => {
  it('describes the version by a hash of the config', () => {
    expect(versionDescription(config)).toMatch(/^Config [0-9a-f]{12}$/);
  });

  it('keeps a version when a config change replaces it, but not when the stack is deleted', () => {
    const stack = new cdk.Stack();
    new VersionedBedrockGuardrail(stack, 'Guardrail', {
      name: 'test-guardrail',
      config,
    });

    const [version] = Object.values(
      Template.fromStack(stack).findResources('AWS::Bedrock::GuardrailVersion'),
    );
    expect(version.UpdateReplacePolicy).toBe('Retain');
    expect(version.DeletionPolicy).toBeUndefined();
  });

  it('gives a changed config a different version description, so the version is replaced', () => {
    expect(
      versionDescription({ ...config, blockedInputMessaging: 'Changed' }),
    ).not.toEqual(versionDescription(config));
  });
});
