import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { seedTenant } from '../src/tenants.js';
import { validateBrief } from '../src/brief/schema.js';

const tenant = seedTenant({ slug: 'acme', name: 'Acme', shareToken: 'tok_acme' });
seedTenant({ slug: 'globex', name: 'Globex', shareToken: 'tok_globex' });

const deps = {
  transcribe: async () => ({
    text: 'Caller was double charged and wants the refund before the fifteenth.',
    segments: [],
    language: 'en',
    model: 'whisper-large-v3-turbo',
    latencyMs: 5,
  }),
  generateBrief: async ({ transcript }) => ({
    brief: {
      caller: { name: null, phone: null, account_ref: null },
      reason: transcript.slice(0, 60),
      already_tried: [],
      promises: [],
      sentiment: { label: 'frustrated', confidence: 0.7 },
      risk_flags: ['payment_dispute'],
      first_line: 'I can see the duplicate charge.',
      confidence: 0.7,
      unknowns: [],
    },
    valid: true,
    error: null,
    attempts: 1,
    warnings: [],
    latencyMs: 9,
  }),
};

function app() {
  return buildServer({ deps });
}

function audioForm({ mimetype = 'audio/wav', filename = 'call.wav', mode = 'transfer' } = {}) {
  const form = new FormData();
  form.append('mode', mode);
  form.append('audio', new Blob([Buffer.from('RIFFfake')], { type: mimetype }), filename);
  return form;
}

async function post(server, form, headers = {}) {
  const request = new Request('http://x/api/briefs', { method: 'POST', body: form });
  return server.inject({
    method: 'POST',
    url: '/api/briefs',
    headers: { ...Object.fromEntries(request.headers), ...headers },
    payload: Buffer.from(await request.arrayBuffer()),
  });
}

test('upload with a valid token returns a schema-valid brief', async () => {
  const server = app();
  const res = await post(server, audioForm(), { 'x-api-token': 'tok_acme' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(validateBrief(body.brief).valid, true);
  assert.equal(body.tenant, 'acme');
  assert.ok(body.callId);
  await server.close();
});

test('missing or wrong token is 401', async () => {
  const server = app();
  assert.equal((await post(server, audioForm())).statusCode, 401);
  assert.equal(
    (await post(server, audioForm(), { 'x-api-token': 'nope' })).statusCode,
    401,
  );
  await server.close();
});

test('non-audio upload is 415', async () => {
  const server = app();
  const res = await post(
    server,
    audioForm({ mimetype: 'application/pdf', filename: 'invoice.pdf' }),
    { 'x-api-token': 'tok_acme' },
  );
  assert.equal(res.statusCode, 415);
  await server.close();
});

test('share link sets the cookie and redirects to the clean URL', async () => {
  const server = app();
  const res = await server.inject({ method: 'GET', url: `/t/acme/${tenant.shareToken}` });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/t/acme');
  assert.match(res.headers['set-cookie'], /tenant_token=tok_acme/);
  assert.match(res.headers['set-cookie'], /HttpOnly/);

  const page = await server.inject({
    method: 'GET',
    url: '/t/acme',
    cookies: { tenant_token: 'tok_acme' },
  });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Transfer Brief/);
  await server.close();
});

test('the token is the credential — the page 401s without it', async () => {
  const server = app();
  assert.equal((await server.inject({ method: 'GET', url: '/t/acme' })).statusCode, 401);
  assert.equal(
    (await server.inject({ method: 'GET', url: '/t/acme/wrong-token' })).statusCode,
    401,
  );
  await server.close();
});

test("one tenant's token cannot open another tenant's page", async () => {
  const server = app();
  const res = await server.inject({
    method: 'GET',
    url: '/t/globex',
    cookies: { tenant_token: 'tok_acme' },
  });
  assert.equal(res.statusCode, 401);
  await server.close();
});

test('the pipeline is called with the resolved tenant, not a default', async () => {
  const seen = [];
  const server = buildServer({
    deps: { ...deps, transcribe: async (...a) => (seen.push('stt'), deps.transcribe(...a)) },
    store: {
      async saveTranscript(t) { seen.push(t.tenantId); },
      async saveBrief() {},
      async recordEvent() {},
      async updateCall() {},
    },
  });
  await post(server, audioForm(), { 'x-api-token': 'tok_globex' });
  assert.ok(seen.includes('ten_globex'), `expected ten_globex, saw ${JSON.stringify(seen)}`);
  await server.close();
});
