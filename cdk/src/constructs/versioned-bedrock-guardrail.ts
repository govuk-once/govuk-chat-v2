import { createHash } from 'node:crypto';
import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';

export type BedrockGuardrailConfig = Omit<bedrock.CfnGuardrailProps, 'name'>;

export interface VersionedBedrockGuardrailProps {
  name: string;
  config: BedrockGuardrailConfig;
}

// A guardrail with one version, built from its config. A version's
// description can't be changed after it's created, so describing it by a
// hash of the config means a config change replaces the version. The old one
// is kept, as agent sessions that started before the change still use it.
export class VersionedBedrockGuardrail extends Construct {
  public readonly guardrailId: string;
  public readonly guardrailArn: string;
  public readonly guardrailVersion: string;

  constructor(
    scope: Construct,
    id: string,
    props: VersionedBedrockGuardrailProps,
  ) {
    super(scope, id);

    const guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: props.name,
      ...props.config,
    });

    const version = new bedrock.CfnGuardrailVersion(this, 'Version', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: `Config ${configHash(props.config)}`,
    });
    version.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;

    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailArn = guardrail.attrGuardrailArn;
    this.guardrailVersion = version.attrVersion;
  }
}

function configHash(config: BedrockGuardrailConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex')
    .slice(0, 12);
}
