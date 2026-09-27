import { getSql } from './db.js';

/**
 * Supabase-backed implementation of the four methods runPipeline calls, plus
 * the call/read helpers the routes need. Same shape as nullStore, so swapping
 * it in changes nothing above this file.
 *
 * Every statement is scoped by tenant_id. There is no unscoped read here.
 */
export const dbStore = {
  async createCall({ tenantId, mode, twilioCallSid = null, from = null, to = null, agentA = null, agentB = null }) {
    const sql = getSql();
    // Twilio retries webhooks, so the same CallSid must reuse its call row.
    const [row] = await sql`
      insert into calls (tenant_id, mode, twilio_call_sid, from_number, to_number, agent_a, agent_b)
      values (${tenantId}, ${mode}, ${twilioCallSid}, ${from}, ${to}, ${agentA}, ${agentB})
      on conflict (twilio_call_sid) where twilio_call_sid is not null
      do update set updated_at = now()
      returning *`;
    return row;
  },

  async updateCall({ callId, tenantId, status }) {
    if (!callId || !status) return;
    const sql = getSql();
    await sql`
      update calls set status = ${status}, updated_at = now()
      where id = ${callId} and tenant_id = ${tenantId}`;
  },

  async saveRecording({ tenantId, callId, source, url = null, durationSec = null, bytes = null }) {
    const sql = getSql();
    const [row] = await sql`
      insert into recordings (tenant_id, call_id, source, url, duration_sec, bytes)
      values (${tenantId}, ${callId}, ${source}, ${url}, ${durationSec}, ${bytes})
      returning *`;
    return row;
  },

  async saveTranscript({ tenantId, callId, recordingId = null, text, segments = [], language, model, latencyMs }) {
    const sql = getSql();
    const [row] = await sql`
      insert into transcripts (tenant_id, call_id, recording_id, text, segments, language, model, latency_ms)
      values (${tenantId}, ${callId}, ${recordingId}, ${text},
              ${sql.json(segments)}, ${language}, ${model}, ${latencyMs})
      returning id`;
    return row;
  },

  async saveBrief({
    tenantId, callId, transcriptId = null, brief, model = null,
    promptVersion = null, schemaVersion = null, attempts = null,
    latencyMs = null, valid = false, error = null,
  }) {
    const sql = getSql();
    const [row] = await sql`
      insert into briefs (tenant_id, call_id, transcript_id, brief, model,
                          prompt_version, schema_version, attempts, latency_ms, valid, error)
      values (${tenantId}, ${callId}, ${transcriptId}, ${sql.json(brief)}, ${model},
              ${promptVersion}, ${schemaVersion}, ${attempts}, ${latencyMs}, ${valid}, ${error})
      returning id`;
    return row;
  },

  async recordEvent({ tenantId, callId = null, kind, payload = {} }) {
    const sql = getSql();
    await sql`
      insert into events (tenant_id, call_id, kind, payload)
      values (${tenantId}, ${callId}, ${kind}, ${sql.json(payload)})`;
  },

  /**
   * Read one call with its latest transcript and brief. Scoped by tenant, so a
   * valid token for tenant A gets nothing for tenant B's call — the route turns
   * that into a 404 rather than a 403, which leaks less.
   */
  async getCall({ tenantId, callId }) {
    const sql = getSql();
    const [call] = await sql`
      select * from calls where id = ${callId} and tenant_id = ${tenantId}`;
    if (!call) return null;

    const [transcript] = await sql`
      select text, language, model, latency_ms from transcripts
      where call_id = ${call.id} and tenant_id = ${tenantId}
      order by created_at desc limit 1`;

    const [brief] = await sql`
      select brief, valid, error, attempts, latency_ms, model, prompt_version from briefs
      where call_id = ${call.id} and tenant_id = ${tenantId}
      order by created_at desc limit 1`;

    return { call, transcript: transcript || null, brief: brief || null };
  },

  async listCalls({ tenantId, limit = 20 }) {
    const sql = getSql();
    return sql`
      select c.id, c.mode, c.status, c.created_at,
             b.brief -> 'reason' as reason, b.valid
      from calls c
      left join lateral (
        select brief, valid from briefs
        where call_id = c.id and tenant_id = ${tenantId}
        order by created_at desc limit 1
      ) b on true
      where c.tenant_id = ${tenantId}
      order by c.created_at desc
      limit ${limit}`;
  },
};
