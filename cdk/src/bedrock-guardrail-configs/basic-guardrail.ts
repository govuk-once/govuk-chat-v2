import {
  ContentFilterStrength,
  ContentFilterType,
  GuardrailAction,
  type ContentFilter,
} from '@aws-cdk/aws-bedrock-alpha';
import type { BedrockGuardrailConfig } from '../constructs/versioned-bedrock-guardrail.ts';

function contentFilter(
  type: ContentFilterType,
  strength: ContentFilterStrength,
): ContentFilter {
  return {
    type,
    inputAction: GuardrailAction.BLOCK,
    inputStrength: strength,
    outputAction: GuardrailAction.BLOCK,
    outputStrength: strength,
  };
}

const promptAttackFilter: ContentFilter = {
  type: ContentFilterType.PROMPT_ATTACK,
  inputAction: GuardrailAction.BLOCK,
  inputStrength: ContentFilterStrength.HIGH,
  outputEnabled: false,
  outputAction: GuardrailAction.NONE,
  outputStrength: ContentFilterStrength.NONE,
};

export const basicGuardrailConfig: BedrockGuardrailConfig = {
  // Bedrock requires these. They're placeholders, as the chat API is going to
  // replace them with its own blocked messages.
  blockedInputMessaging: '[Question blocked by the guardrail]',
  blockedOutputsMessaging: '[Answer blocked by the guardrail]',
  contentFilters: [
    contentFilter(ContentFilterType.SEXUAL, ContentFilterStrength.LOW),
    contentFilter(ContentFilterType.VIOLENCE, ContentFilterStrength.HIGH),
    contentFilter(ContentFilterType.HATE, ContentFilterStrength.HIGH),
    contentFilter(ContentFilterType.INSULTS, ContentFilterStrength.HIGH),
    contentFilter(ContentFilterType.MISCONDUCT, ContentFilterStrength.HIGH),
    promptAttackFilter,
  ],
};
