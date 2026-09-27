import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.js';
import { validateBrief } from '../src/brief/schema.js';

const audio = { buffer: Buffer.from('fake'), filename: 'call.wav', mimetype: 'audio/wav' };

const fakeStt = (text) => async () => ({
  text,
  segments: [],
  language: 'en',
  model: 'whisper-large-v3-turbo',
  latencyMs: 12,
});

const fakeBrief = async ({ transcript }) => ({
  brief: {
    caller: { name: null, phone: null, account_ref: null },
    reason: transcript.slice(0, 40),
    already_tried: [],
    promises: [],
    sentiment: { label: 'neutral', confidence: 0.5 },
    risk_flags: ['none'],
    first_line: 'Picking this up now.',
    confidence: 0.5,
    unknowns: [],
  },
  valid: true,
  error: null,
  attempts: 1,
  latencyMs: 30,
});

function recordingStore() {
  const calls = { transcripts: [], briefs: [], statuses: [] };
  return {
    calls,
    async saveTranscript(t) { calls.transcripts.push(t); },
    async saveBrief(b) { calls.briefs.push(b); },
    async recordEvent() {},
    async updateCall({ status }) { calls.statuses.push(status); },
  };
}

test('happy path returns a valid brief and per-stage timings', async () => {
  const result = await runPipeline({
    tenant: { id: 't1', slug: 'demo' },
    callId: 'c1',
    audio,
    mode: 'transfer',
    deps: { transcribe: fakeStt('Caller is double charged and wants a refund.'), generateBrief: fakeBrief },
  });

  assert.equal(validateBrief(result.brief).valid, true);
  assert.equal(result.valid, true);
  assert.ok(result.timings.totalMs >= 0);
  assert.equal(result.transcript.text, 'Caller is double charged and wants a refund.');
});

test('transcript is persisted before the model is called', async () => {
  const store = recordingStore();
  await runPipeline({
    tenant: { id: 't1' },
    callId: 'c1',
    audio,
    store,
    deps: {
      transcribe: fakeStt('A caller with a billing problem that needs escalating.'),
      generateBrief: async () => { throw new Error('model exploded'); },
    },
  }).catch(() => {});

  assert.equal(store.calls.transcripts.length, 1, 'transcript should survive an LLM failure');
  assert.equal(store.calls.briefs.length, 0);
});

test('card digits are redacted before anything is persisted', async () => {
  const store = recordingStore();
  const result = await runPipeline({
    tenant: { id: 't1' },
    callId: 'c1',
    audio,
    store,
    deps: {
      transcribe: fakeStt('My card is 4111 1111 1111 1111 and the charge failed.'),
      generateBrief: fakeBrief,
    },
  });

  assert.ok(!store.calls.transcripts[0].text.includes('4111'));
  assert.ok(result.transcript.text.includes('[REDACTED_CARD]'));
});

test('a silent recording still produces a bridgeable brief', async () => {
  const result = await runPipeline({
    tenant: { id: 't1' },
    callId: 'c1',
    audio,
    deps: { transcribe: fakeStt('  '), generateBrief: async () => { throw new Error('should not be called'); } },
  });

  assert.equal(result.valid, false);
  assert.equal(validateBrief(result.brief).valid, true, 'fallback must still be schema-valid');
  assert.ok(result.brief.first_line.length > 0);
});
