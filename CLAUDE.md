# Warm Transfer Brief — CLAUDE.md

Before an agent picks up a transferred call they get a brief: who's calling, why, what's been tried, what was promised,
sentiment, risk flags, first line to say. **Multi-tenant** — several people demo at once, each with their own numbers, greeting, and data.

## Stack (fixed)
Node 20 (ESM) · Fastify · Supabase Postgres · Groq `whisper-large-v3-turbo` · Anthropic `claude-sonnet-4-6` with
JSON-schema tool output · Twilio Voice · Render web service, env secrets.

## Modes
- **transfer** — `POST /voice/transfer` → `<Dial record="record-from-answer-dual">` agent A. On `action`/`recordingStatusCallback`:
  fetch recording → transcribe → brief → `<Dial>` agent B with `url=/voice/whisper/:callId`, which `<Say>`s `first_line` + `reason` before bridging.
- **intake** — `POST /voice/intake` → `<Say>` greeting → `<Record>` caller → brief → `<Dial>` forward (same whisper).
- **try-it** — `GET /t/:slug` upload page → `POST /api/briefs` (multipart), same pipeline, no Twilio. Full brief renders at `GET /calls/:id`.
  One `runPipeline({ tenant, callId, audio, mode })` behind all three; Twilio routes are thin adapters over it.

## Tenancy
Every row carries `tenant_id` and every query filters on it — no unscoped reads, ever. Resolution: Twilio webhooks → `tenants.twilio_number == To`
(unknown `To` falls back to `DEFAULT_TENANT_SLUG` so a misconfigured number still answers); everything else → `share_token`, accepted from the link
(`/t/:slug/:token`, or `?k=`), an `X-Api-Token` header, or a `tenant_token` cookie. A link load sets the cookie and 302s to the clean `/t/:slug`,
so one URL is the whole credential — share the link, nothing else. `/calls/:id` takes the same token and 404s across tenants.
`scripts/seed-tenant.js --slug acme --twilio +1… --agent-a +1… --agent-b +1…` creates a tenant and prints its token + URLs;
`scripts/run-pipeline.js --tenant acme --file fixtures/x.wav` runs the whole pipeline headless for that tenant.

## Data model (proposal)
- `tenants` — id, slug (unique), name, twilio_number (unique), agent_a_number, agent_b_number, forward_number, greeting, prompt_overrides jsonb, share_token (unique, high-entropy), active, created_at.
- `calls` — id, tenant_id, mode, twilio_call_sid, from_number, to_number, agent_a, agent_b, created_at, updated_at,
  status (`ringing|recording|transcribing|briefing|bridged|failed`).
- `recordings` — id, tenant_id, call_id, source (`twilio|upload`), url, duration_sec, bytes, fetched_at.
- `transcripts` — id, tenant_id, call_id, recording_id, text, segments jsonb, language, model, latency_ms.
- `briefs` — id, tenant_id, call_id, transcript_id, brief jsonb, model, prompt_version, latency_ms, valid, error.
- `events` — id, tenant_id, call_id, kind, payload jsonb, created_at; append-only debug view. One row per artifact per stage, so a failed stage stays visible instead of overwritten.

## Brief JSON schema (v1)
```jsonc
{
  "caller": { "name": "string|null", "phone": "string|null", "account_ref": "string|null" },
  "reason": "string",                        // <= 200 chars, why they called
  "already_tried": ["string"],               // steps taken on the call so far
  "promises": [{ "what": "string", "by_when": "string|null" }],
  "sentiment": { "label": "calm|frustrated|angry|distressed|neutral", "confidence": 0.0 },
  "risk_flags": ["churn|escalation|legal|vulnerable_customer|payment_dispute|none"],
  "first_line": "string",                    // <= 160 chars, what agent B says on pickup
  "confidence": 0.0, "unknowns": ["string"]  // overall 0-1; what the transcript did not answer
}
```
Every key required. Unknown → `null` / `[]` / `"none"`, never invented. `additionalProperties: false`.

## Schema validation
Schema lives once in `src/brief/schema.js`; the same object feeds the Anthropic tool definition and an Ajv validator. Invalid → one retry
with the Ajv errors appended → else persist a fallback brief (`reason: "unavailable"`, generic `first_line`, `valid=false`). The call always bridges.

## Stages — simplest working thing first, deployed before it's complete
1. `runPipeline` + `run-pipeline.js` over a local wav, brief to stdout. 2. Fastify + `/api/briefs` + Try-it page. 3. Supabase + tenants +
`seed-tenant.js` + `/calls/:id`. **4. Deploy to Render and seed two tenants — demo-able from here on, before any Twilio work.**
5. intake (Say → Record → brief → forward). 6. transfer (Dial A → recording → brief → Dial B + whisper). A live partial demo beats a local complete one: redeploy at each later stage, and at T-15 cut whatever isn't working rather than rush it in.

## Non-obvious choices
- Tenant keyed by inbound `To`: Twilio tells us who was called, so there's no per-tenant webhook config to drift.
- Token per tenant, not one global secret: the Render URL is public and one demo must not read another's calls. It rides in the link because
  sharing credentials is clunky — a high-entropy `share_token`, redacted from logs, cookie'd on first load so it stops riding in URLs, rotatable via the seed script.
- Dual-channel recording: caller and agent on separate channels, so "already tried" vs "promised" can be attributed. Twilio recording URLs need Basic auth and lag the callback — fetch with retry/backoff, don't trust the first 404.
- The brief runs while the caller hears hold music. Measured on a 79s fixture: 1s STT + 7s brief ≈ 8s, so hold music must cover ~10s, not the ~6s first assumed. Groq keeps STT ~1s; the brief is output-token-bound, so `effort` barely moves it (medium ≈ high, and is cheaper).
  Persist the transcript before calling the model; audio is never stored, only the Twilio URL. Webhooks idempotent on `CallSid` + stage.
- Try-it ships before any Twilio route: it exercises the whole pipeline with no phone, so it's the demo that can't fail on stage.

## Edge cases
Unknown/duplicate `To` · inactive tenant · tenant A's token requesting tenant B's call (404, not 403) · recording <3s or silent · caller hangs up mid-record · agent B busy/no-answer · Twilio recording 404 or still processing · non-English or heavy accent · STT empty · model returns prose not a tool-call · hallucinated promise · card/SSN digits (redact before persist) · duplicate webhook · brief slower than ring timeout · upload >25MB or wrong mime · missing env var at boot (fail fast, not per-request 500) · a shared link forwarded to the wrong person (rotate the token, don't log it).

## Tests
- `transfer`: TwiML snapshots legs 1 and 2; action-callback with fixture → brief persisted, leg 2 dials agent B, whisper TwiML contains `first_line`; agent-B-no-answer → voicemail fallback.
- `intake`: greeting TwiML uses the tenant's `greeting`; `<Record>` callback → brief → forward; empty recording → forward anyway.
- `try-it`: multipart upload → 200 + valid brief; non-audio → 415; bad or missing token → 401; `/t/:slug/:token` sets the cookie and redirects clean.
- `tenancy`: two seeded tenants, same fixture → separate calls; tenant A's token on tenant B's `/calls/:id` → 404; unknown `To` → default tenant.
- `schema`: golden briefs validate; each required key missing → rejected; prose response → retry → fallback. Groq/Anthropic/Twilio faked at the client boundary; one opt-in live test behind `LIVE=1`.

## How to work with me
- Timed build. Propose, then act — don't stop to ask unless a wrong guess costs more than 5 minutes.
- Smallest working version first, end to end, then deepen. No scaffolding for features not in scope.
- Show me diffs and the command to verify; say plainly when something is untested or faked. Secrets in env only, never in code or tests.
- Flag every deviation from this file in one line rather than silently improving on it.
