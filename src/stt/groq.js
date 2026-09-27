import { config } from '../config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Transcribe audio with Groq whisper-large-v3-turbo.
 * @param {{buffer: Buffer|Uint8Array, filename: string, mimetype?: string}} audio
 * @returns {Promise<{text: string, segments: Array, language: string|null, model: string, latencyMs: number}>}
 */
export async function transcribe(audio, { signal } = {}) {
  if (!config.groqApiKey) throw new Error('GROQ_API_KEY is not set');

  const form = new FormData();
  form.append(
    'file',
    new Blob([audio.buffer], { type: audio.mimetype || 'audio/wav' }),
    audio.filename || 'audio.wav',
  );
  form.append('model', config.sttModel);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  const startedAt = Date.now();
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: form,
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq STT ${res.status}: ${detail.slice(0, 400)}`);
  }

  const json = await res.json();
  return {
    text: (json.text || '').trim(),
    segments: json.segments || [],
    language: json.language || null,
    durationSec: json.duration ?? null,
    model: config.sttModel,
    latencyMs: Date.now() - startedAt,
  };
}
