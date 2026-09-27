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

test('TENANTS env parsing rejects the mistakes that would leak data', async () => {
  const { tenantsFromEnv } = await import('../src/tenants.js');
  assert.deepEqual(tenantsFromEnv(undefined), []);
  assert.equal(tenantsFromEnv('[{"slug":"a","shareToken":"t1"}]').length, 1);

  assert.throws(() => tenantsFromEnv('not json'), /not valid JSON/);
  assert.throws(() => tenantsFromEnv('{"slug":"a"}'), /must be a JSON array/);
  assert.throws(() => tenantsFromEnv('[{"name":"a","shareToken":"t"}]'), /no slug/);
  assert.throws(() => tenantsFromEnv('[{"slug":"a"}]'), /no shareToken/);
  // Two tenants sharing a token would hand one of them the other's calls.
  assert.throws(
    () => tenantsFromEnv('[{"slug":"a","shareToken":"t"},{"slug":"b","shareToken":"t"}]'),
    /reuses a shareToken/,
  );
  assert.throws(
    () => tenantsFromEnv('[{"slug":"a","shareToken":"t1"},{"slug":"a","shareToken":"t2"}]'),
    /reuses the slug/,
  );
  // Sharing a Twilio number would route every inbound call to the first tenant.
  assert.throws(
    () => tenantsFromEnv('[{"slug":"a","shareToken":"t1","twilioNumber":"+1555"},{"slug":"b","shareToken":"t2","twilioNumber":"+1555"}]'),
    /reuses twilioNumber/,
  );
  // Sharing a forward number is fine — two tenants can ring the same agent.
  assert.equal(
    tenantsFromEnv('[{"slug":"a","shareToken":"t1","forward":"+1555"},{"slug":"b","shareToken":"t2","forward":"+1555"}]').length,
    2,
  );
});

test('GET /calls/:id serves the stored brief, and 404s across tenants', async () => {
  // Stands in for dbStore: the point under test is that the route passes the
  // requesting tenant's id down and treats a non-match as "no such call".
  const stored = {
    tenantId: 'ten_acme',
    record: {
      call: { id: 'call-1', mode: 'transfer', status: 'bridged', created_at: new Date() },
      transcript: { text: 'Caller wants a refund.' },
      brief: {
        valid: true,
        attempts: 1,
        latency_ms: 7000,
        model: 'claude-sonnet-4-6',
        brief: {
          caller: { name: 'Priya', phone: null, account_ref: null },
          reason: 'Double charged.',
          already_tried: ['called once'],
          promises: [{ what: 'refund', by_when: 'the 15th' }],
          sentiment: { label: 'frustrated', confidence: 0.8 },
          risk_flags: ['churn'],
          first_line: 'Priya, I can see the duplicate charge.',
          confidence: 0.8,
          unknowns: [],
        },
      },
    },
  };
  const server = buildServer({
    deps,
    store: {
      async saveTranscript() {}, async saveBrief() {}, async recordEvent() {}, async updateCall() {},
      async getCall({ tenantId, callId }) {
        return tenantId === stored.tenantId && callId === 'call-1' ? stored.record : null;
      },
    },
  });

  const mine = await server.inject({
    method: 'GET', url: '/calls/call-1', cookies: { tenant_token: 'tok_acme' },
  });
  assert.equal(mine.statusCode, 200);
  assert.match(mine.body, /Priya, I can see the duplicate charge/);

  const theirs = await server.inject({
    method: 'GET', url: '/calls/call-1', cookies: { tenant_token: 'tok_globex' },
  });
  assert.equal(theirs.statusCode, 404, 'cross-tenant read must be 404, never 403');

  const anon = await server.inject({ method: 'GET', url: '/calls/call-1' });
  assert.equal(anon.statusCode, 401);
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

test('the sample recording is served, and only from the allowlist', async () => {
  const server = app();
  const ok = await server.inject({ method: 'GET', url: '/samples/sample-call.wav' });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-type'], /audio\/wav/);
  assert.ok(ok.rawPayload.length > 1000, 'sample should have real audio in it');

  // The name is a key into an allowlist, never a filesystem path.
  assert.equal((await server.inject({ method: 'GET', url: '/samples/nope.m4a' })).statusCode, 404);
  await server.close();
});
