import { transcribe as groqTranscribe } from './stt/groq.js';
import { generateBrief as anthropicBrief } from './brief/generate.js';
import { redact } from './redact.js';
import { fallbackBrief } from './brief/schema.js';

// No-op store for stage 1. Stage 3 swaps in the Supabase implementation without
// touching this file: same four methods, same arguments.
export const nullStore = {
  async saveTranscript() {},
  async saveBrief() {},
  async recordEvent() {},
  async updateCall() {},
};

const MIN_TRANSCRIPT_CHARS = 12;

/**
 * The one path every mode goes through: audio -> transcript -> brief.
 * Twilio routes and the Try-it upload are thin adapters over this.
 */
export async function runPipeline({
  tenant,
  callId,
  audio,
  mode = 'try-it',
  store = nullStore,
  deps = {},
}) {
  const transcribe = deps.transcribe || groqTranscribe;
  const generateBrief = deps.generateBrief || anthropicBrief;
  const startedAt = Date.now();

  await store.updateCall({ callId, status: 'transcribing' });
  const stt = await transcribe(audio);
  const text = redact(stt.text);

  // Persist the transcript before calling the model — an LLM failure must not
  // lose the call record.
  await store.saveTranscript({
    tenantId: tenant?.id,
    callId,
    text,
    segments: stt.segments,
    language: stt.language,
    model: stt.model,
    latencyMs: stt.latencyMs,
  });

  if (text.length < MIN_TRANSCRIPT_CHARS) {
    const empty = {
      brief: fallbackBrief('nothing audible on the recording'),
      valid: false,
      error: 'transcript too short',
      attempts: 0,
      latencyMs: 0,
    };
    await store.saveBrief({ tenantId: tenant?.id, callId, ...empty });
    await store.updateCall({ callId, status: 'briefing' });
    return { transcript: { ...stt, text }, ...empty, timings: timings(startedAt, stt, empty) };
  }

  await store.updateCall({ callId, status: 'briefing' });
  const result = await generateBrief({ transcript: text, mode });
  await store.saveBrief({ tenantId: tenant?.id, callId, ...result });

  return {
    transcript: { ...stt, text },
    ...result,
    timings: timings(startedAt, stt, result),
  };
}

function timings(startedAt, stt, brief) {
  return {
    sttMs: stt.latencyMs ?? null,
    briefMs: brief.latencyMs ?? null,
    totalMs: Date.now() - startedAt,
  };
}
