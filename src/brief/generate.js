import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { briefSchema, validateBrief, fallbackBrief, BRIEF_SCHEMA_VERSION } from './schema.js';
import { SYSTEM_PROMPT, PROMPT_VERSION, userPrompt } from './prompt.js';

const TOOL_NAME = 'emit_brief';

// Sonnet 4.6 does not support output_config.format, so the JSON schema is
// carried by a forced tool call and validated with Ajv on our side.
const briefTool = {
  name: TOOL_NAME,
  description: 'Emit the transfer brief for the agent about to pick up the call.',
  input_schema: briefSchema,
};

let client;
function getClient() {
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

function extractToolUse(response) {
  // block.input is already parsed by the SDK — never string-match the raw JSON.
  return response.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME) ?? null;
}

/**
 * Generate a schema-valid brief. One retry with the Ajv errors appended,
 * then a fallback brief so the call always bridges.
 */
export async function generateBrief({ transcript, mode = 'try-it' }) {
  const startedAt = Date.now();
  const anthropic = getClient();

  const messages = [{ role: 'user', content: userPrompt({ transcript, mode }) }];
  let lastErrors = [];
  // Kept even when a retry succeeds — a silently-retried brief is a prompt bug
  // we'd otherwise never see.
  const warnings = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await anthropic.messages.create({
      model: config.briefModel,
      max_tokens: 2000,
      // The caller is on hold while this runs; medium effort holds quality on a
      // single-transcript extraction and costs noticeably less latency than high.
      output_config: { effort: config.briefEffort },
      system: SYSTEM_PROMPT,
      tools: [briefTool],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages,
    });

    const toolUse = extractToolUse(response);
    if (toolUse) {
      const { valid, errors } = validateBrief(toolUse.input);
      if (valid) {
        return {
          brief: toolUse.input,
          valid: true,
          error: null,
          model: config.briefModel,
          promptVersion: PROMPT_VERSION,
          schemaVersion: BRIEF_SCHEMA_VERSION,
          attempts: attempt + 1,
          warnings,
          latencyMs: Date.now() - startedAt,
        };
      }
      lastErrors = errors;
    } else {
      lastErrors = ['model returned prose instead of a tool call'];
    }
    warnings.push(`attempt ${attempt + 1}: ${lastErrors.join('; ')}`);

    // Every tool_use block needs a matching tool_result, or the retry request 400s.
    const correction = `That brief failed schema validation:\n${lastErrors.join('\n')}\n\nCall ${TOOL_NAME} again with a corrected brief.`;
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: toolUse
          ? [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                is_error: true,
                content: correction,
              },
            ]
          : correction,
      },
    );
  }

  return {
    brief: fallbackBrief(),
    valid: false,
    error: lastErrors.join('; '),
    model: config.briefModel,
    promptVersion: PROMPT_VERSION,
    schemaVersion: BRIEF_SCHEMA_VERSION,
    attempts: 2,
    warnings,
    latencyMs: Date.now() - startedAt,
  };
}
