import { config } from './config.js';
import { findTenantByTwilioNumber, findTenantBySlug } from './tenants.js';
import { runPipeline } from './pipeline.js';
import { fetchRecording } from './twilio/recording.js';
import { isValidTwilioSignature, publicUrlFor } from './twilio/signature.js';
import {
  intakeTwiml,
  dialWithWhisperTwiml,
  whisperTwiml,
  sayAndHangupTwiml,
} from './twilio/twiml.js';

/**
 * Briefs keyed by CallSid so the whisper URL can read one back. Only used when
 * there is no database; a Map is fine because the whisper fires seconds later
 * on the same instance.
 */
const briefCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheBrief(callSid, brief) {
  briefCache.set(callSid, { brief, at: Date.now() });
  for (const [key, value] of briefCache) {
    if (Date.now() - value.at > CACHE_TTL_MS) briefCache.delete(key);
  }
}
const cachedBrief = (callSid) => briefCache.get(callSid)?.brief || null;

/** Unknown To falls back to DEFAULT_TENANT_SLUG so a misconfigured number still answers. */
async function resolveTenant(to) {
  return (await findTenantByTwilioNumber(to)) || (await findTenantBySlug(config.defaultTenantSlug));
}

export function registerVoiceRoutes(app, { store, deps = {} } = {}) {
  const twiml = (reply, xml) => reply.type('text/xml').send(xml);

  // Twilio signs the exact URL it called, including the query string.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/voice/')) return;
    if (config.skipTwilioValidation) return;
    const valid = isValidTwilioSignature({
      authToken: config.twilioAuthToken,
      url: publicUrlFor(req),
      params: req.body || {},
      signature: req.headers['x-twilio-signature'],
    });
    if (!valid) {
      req.log?.warn?.({ url: req.url }, 'rejected unsigned Twilio request');
      return reply.code(403).type('text/xml').send(sayAndHangupTwiml('Request could not be verified.'));
    }
  });

  // 1. Inbound call: greet, then record the caller.
  app.post('/voice/intake', async (req, reply) => {
    const tenant = await resolveTenant(req.body?.To);
    if (!tenant) return twiml(reply, sayAndHangupTwiml('This number is not configured.'));

    await store.recordEvent?.({
      tenantId: tenant.id,
      kind: 'voice.intake.start',
      payload: { callSid: req.body?.CallSid, from: req.body?.From, to: req.body?.To },
    });

    return twiml(
      reply,
      intakeTwiml({
        greeting: tenant.greeting,
        actionUrl: `/voice/intake/recording?tenant=${encodeURIComponent(tenant.slug)}`,
      }),
    );
  });

  // 2. Recording finished: transcribe, brief, then bridge to the agent.
  app.post('/voice/intake/recording', async (req, reply) => {
    const tenant =
      (await findTenantBySlug(req.query?.tenant)) || (await resolveTenant(req.body?.To));
    if (!tenant) return twiml(reply, sayAndHangupTwiml('This number is not configured.'));

    const callSid = req.body?.CallSid;
    const forward = tenant.forward || tenant.agentB || tenant.agentA;
    if (!forward) {
      return twiml(reply, sayAndHangupTwiml('No agent is configured to take this call. Goodbye.'));
    }

    const dial = () =>
      twiml(
        reply,
        dialWithWhisperTwiml({
          to: forward,
          callerId: tenant.twilioNumber || req.body?.To,
          whisperUrl: `/voice/whisper/${encodeURIComponent(callSid)}`,
          holdMessage: 'Thank you. Connecting you now.',
        }),
      );

    // No recording (caller hung up or said nothing): forward anyway rather than
    // dropping a live caller.
    if (!req.body?.RecordingUrl) {
      await store.recordEvent?.({
        tenantId: tenant.id,
        kind: 'voice.intake.no_recording',
        payload: { callSid },
      });
      return dial();
    }

    try {
      const audio = await (deps.fetchRecording || fetchRecording)(req.body.RecordingUrl);
      const call = store.createCall
        ? await store.createCall({
            tenantId: tenant.id,
            mode: 'intake',
            twilioCallSid: callSid,
            from: req.body?.From,
            to: req.body?.To,
            agentB: forward,
          })
        : null;

      const result = await runPipeline({
        tenant,
        callId: call?.id || callSid,
        mode: 'intake',
        audio,
        store,
        deps,
      });

      cacheBrief(callSid, result.brief);
      await store.updateCall?.({ callId: call?.id, tenantId: tenant.id, status: 'bridged' });
    } catch (err) {
      // A failed brief must never drop the call — bridge without one.
      req.log?.error?.({ err, callSid }, 'intake brief failed');
      await store.recordEvent?.({
        tenantId: tenant.id,
        kind: 'voice.intake.brief_failed',
        payload: { callSid, error: err.message },
      });
    }

    return dial();
  });

  // 3. Whisper: the agent hears this before the caller is bridged in.
  app.post('/voice/whisper/:callSid', async (req, reply) => {
    let brief = cachedBrief(req.params.callSid);
    if (!brief && store.getCallByTwilioSid) {
      const record = await store.getCallByTwilioSid({ twilioCallSid: req.params.callSid });
      brief = record?.brief?.brief || null;
    }
    return twiml(reply, whisperTwiml({ brief }));
  });

  return app;
}

export const __testing = { briefCache, cacheBrief, cachedBrief };
