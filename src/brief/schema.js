import Ajv from 'ajv';

export const BRIEF_SCHEMA_VERSION = 'v1';

// One object, two consumers: the Anthropic tool definition and the Ajv validator.
export const briefSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'caller',
    'reason',
    'already_tried',
    'promises',
    'sentiment',
    'risk_flags',
    'first_line',
    'confidence',
    'unknowns',
  ],
  properties: {
    caller: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'phone', 'account_ref'],
      properties: {
        name: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        account_ref: { type: ['string', 'null'] },
      },
    },
    reason: { type: 'string', maxLength: 200 },
    already_tried: { type: 'array', items: { type: 'string' } },
    promises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'by_when'],
        properties: {
          what: { type: 'string' },
          by_when: { type: ['string', 'null'] },
        },
      },
    },
    sentiment: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'confidence'],
      properties: {
        label: {
          type: 'string',
          enum: ['calm', 'frustrated', 'angry', 'distressed', 'neutral'],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    risk_flags: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'churn',
          'escalation',
          'legal',
          'vulnerable_customer',
          'payment_dispute',
          'none',
        ],
      },
    },
    first_line: { type: 'string', maxLength: 160 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = ajv.compile(briefSchema);

export function validateBrief(candidate) {
  const valid = compiled(candidate);
  return {
    valid,
    errors: valid
      ? []
      : compiled.errors.map((e) => `${e.instancePath || '/'} ${e.message}`),
  };
}

// Persisted when the model can't produce a valid brief. The call still bridges.
export function fallbackBrief(reason = 'unavailable') {
  return {
    caller: { name: null, phone: null, account_ref: null },
    reason,
    already_tried: [],
    promises: [],
    sentiment: { label: 'neutral', confidence: 0 },
    risk_flags: ['none'],
    first_line:
      "Thanks for holding — I'm picking this up now. Can you tell me what you're calling about?",
    confidence: 0,
    unknowns: ['brief generation failed'],
  };
}
