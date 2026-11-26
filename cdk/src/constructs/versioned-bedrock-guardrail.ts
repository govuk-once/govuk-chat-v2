import { createHash } from 'node:crypto';
import * as bedrockAlpha from '@aws-cdk/aws-bedrock-alpha';
import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import type * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export type BedrockGuardrailConfig = Omit<
  bedrockAlpha.GuardrailProps,
  'guardrailName'
>;

export interface VersionedBedrockGuardrailProps {
  name: string;
  config: BedrockGuardrailConfig;
}

// A guardrail with one version, built from its config. A version's
// description can't be changed after it's created, so describing it by a
// hash of the config means a config change replaces the version. The old one
// is kept, as agent sessions that started before the change still use it.
// The L2 guardrail's own createVersion() can't do this: it names the version
// after unresolved tokens rather than the config, so a config change doesn't
// reliably create a new version, and an unrelated change can.
export class VersionedBedrockGuardrail extends Construct {
  private readonly guardrail: bedrockAlpha.Guardrail;
  public readonly guardrailId: string;
  public readonly guardrailVersion: string;

  constructor(
    scope: Construct,
    id: string,
    props: VersionedBedrockGuardrailProps,
  ) {
    super(scope, id);

    this.guardrail = new bedrockAlpha.Guardrail(this, 'Guardrail', {
      guardrailName: props.name,
      ...props.config,
    });

    const version = new bedrock.CfnGuardrailVersion(this, 'Version', {
      guardrailIdentifier: this.guardrail.guardrailId,
      description: `Config ${configHash(props.config)}`,
    });
    version.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;

    this.guardrailId = this.guardrail.guardrailId;
    this.guardrailVersion = version.attrVersion;
  }

  grantApply(grantee: iam.IGrantable): iam.Grant {
    return this.guardrail.grantApply(grantee);
  }
}

function configHash(config: BedrockGuardrailConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex')
    .slice(0, 12);
}
