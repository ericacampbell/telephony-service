import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { seedTenant } from '../src/tenants.js';
import { isValidTwilioSignature } from '../src/twilio/signature.js';
import { createHmac } from 'node:crypto';

process.env.SKIP_TWILIO_VALIDATION = 'true';

seedTenant({
  slug: 'voice',
  name: 'Voice Co',
  twilioNumber: '+15550001111',
  forward: '+15559998888',
  greeting: 'Thanks for calling Voice Co. Tell us what you need.',
  shareToken: 'tok_voice',
});

const brief = {
  caller: { name: 'Priya', phone: null, account_ref: null },
  reason: 'Double charged on the September bill',
  already_tried: ['called last Tuesday'],
  promises: [],
  sentiment: { label: 'frustrated', confidence: 0.8 },
  risk_flags: ['churn'],
  first_line: 'Priya, I can see the duplicate charge.',
  confidence: 0.8,
  unknowns: [],
};

const deps = {
  fetchRecording: async () => ({
    buffer: Buffer.from('fake'),
    filename: 'recording.wav',
    mimetype: 'audio/wav',
  }),
  transcribe: async () => ({
    text: 'I was double charged and nobody has fixed it.',
    segments: [],
    language: 'en',
    model: 'whisper-large-v3-turbo',
    latencyMs: 5,
  }),
  generateBrief: async () => ({
    brief, valid: true, error: null, attempts: 1, warnings: [], latencyMs: 9,
  }),
};

const form = (obj) => new URLSearchParams(obj).toString();
const post = (server, url, body) =>
  server.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form(body),
  });

test('intake greets with the tenant greeting and records', async () => {
  const server = buildServer({ deps });
  const res = await post(server, '/voice/intake', {
    CallSid: 'CA1', From: '+15551234567', To: '+15550001111',
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/xml/);
  assert.match(res.body, /Thanks for calling Voice Co/);
  assert.match(res.body, /<Record[^>]+action="\/voice\/intake\/recording\?tenant=voice"/);
  await server.close();
});

test('recording callback briefs the call and dials the forward number', async () => {
  const server = buildServer({ deps });
  const res = await post(server, '/voice/intake/recording?tenant=voice', {
    CallSid: 'CA2', To: '+15550001111',
    RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingDuration: '31',
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<Dial/);
  assert.match(res.body, /\+15559998888/);
  assert.match(res.body, /url="\/voice\/whisper\/CA2"/);

  // The whisper the agent hears must carry the first line.
  const whisper = await post(server, '/voice/whisper/CA2', { CallSid: 'CA2' });
  assert.match(whisper.body, /Priya, I can see the duplicate charge/);
  assert.match(whisper.body, /frustrated/);
  await server.close();
});

test('a caller who says nothing is still forwarded, not dropped', async () => {
  const server = buildServer({ deps });
  const res = await post(server, '/voice/intake/recording?tenant=voice', {
    CallSid: 'CA3', To: '+15550001111',
  });
  assert.match(res.body, /<Dial/);
  assert.match(res.body, /\+15559998888/);
  await server.close();
});

test('a failed brief still bridges the call', async () => {
  const server = buildServer({
    deps: { ...deps, transcribe: async () => { throw new Error('groq exploded'); } },
  });
  const res = await post(server, '/voice/intake/recording?tenant=voice', {
    CallSid: 'CA4', To: '+15550001111', RecordingUrl: 'https://api.twilio.com/rec/RE4',
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<Dial/, 'the caller must not be dropped because the brief failed');

  const whisper = await post(server, '/voice/whisper/CA4', { CallSid: 'CA4' });
  assert.match(whisper.body, /No brief is available/);
  await server.close();
});

test('an unknown To number falls back to the default tenant', async () => {
  const server = buildServer({ deps });
  const res = await post(server, '/voice/intake', {
    CallSid: 'CA5', To: '+19999999999',
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<Say|<Response/);
  await server.close();
});

test('signature validation accepts a correctly signed request and rejects tampering', () => {
  const authToken = 'secret-token';
  const url = 'https://example.com/voice/intake';
  const params = { CallSid: 'CA9', From: '+15551112222', To: '+15550001111' };
  const payload = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const signature = createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest('base64');

  assert.equal(isValidTwilioSignature({ authToken, url, params, signature }), true);
  assert.equal(
    isValidTwilioSignature({ authToken, url, params: { ...params, To: '+10000000000' }, signature }),
    false,
    'a changed parameter must invalidate the signature',
  );
  assert.equal(isValidTwilioSignature({ authToken, url, params, signature: 'nope' }), false);
  assert.equal(isValidTwilioSignature({ authToken: null, url, params, signature }), false);
});
