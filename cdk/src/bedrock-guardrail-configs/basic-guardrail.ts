import type * as bedrock from 'aws-cdk-lib/aws-bedrock';
import type { BedrockGuardrailConfig } from '../constructs/versioned-bedrock-guardrail.ts';

type ContentFilterType =
  'SEXUAL' | 'VIOLENCE' | 'HATE' | 'INSULTS' | 'MISCONDUCT';
type FilterStrength = 'LOW' | 'MEDIUM' | 'HIGH';

function contentFilter(
  type: ContentFilterType,
  strength: FilterStrength,
): bedrock.CfnGuardrail.ContentFilterConfigProperty {
  return {
    type,
    inputEnabled: true,
    inputAction: 'BLOCK',
    inputStrength: strength,
    outputEnabled: true,
    outputAction: 'BLOCK',
    outputStrength: strength,
  };
}

const promptAttackFilter: bedrock.CfnGuardrail.ContentFilterConfigProperty = {
  type: 'PROMPT_ATTACK',
  inputEnabled: true,
  inputAction: 'BLOCK',
  inputStrength: 'HIGH',
  outputEnabled: false,
  outputAction: 'NONE',
  outputStrength: 'NONE',
};

export const basicGuardrailConfig: BedrockGuardrailConfig = {
  blockedInputMessaging: 'The message you sent contained banned content',
  blockedOutputsMessaging:
    'The generated response did not meet our quality standards, please rephrase and ask again.',
  contentPolicyConfig: {
    filtersConfig: [
      contentFilter('SEXUAL', 'LOW'),
      contentFilter('VIOLENCE', 'HIGH'),
      contentFilter('HATE', 'HIGH'),
      contentFilter('INSULTS', 'HIGH'),
      contentFilter('MISCONDUCT', 'HIGH'),
      promptAttackFilter,
    ],
  },
};
