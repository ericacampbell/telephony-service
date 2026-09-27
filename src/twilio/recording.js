import { config } from '../config.js';

/**
 * Twilio's RecordingUrl needs Basic auth, and the media lags the callback —
 * a 404 right after the webhook is normal, not fatal. Retry with backoff.
 */
export async function fetchRecording(recordingUrl, { attempts = 5, baseDelayMs = 400 } = {}) {
  if (!config.twilioAccountSid || !config.twilioAuthToken) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set');
  }
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const url = recordingUrl.endsWith('.wav') ? recordingUrl : `${recordingUrl}.wav`;

  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, filename: 'recording.wav', mimetype: 'audio/wav', bytes: buffer.length };
    }
    lastStatus = res.status;
    // 404 = still processing. Anything else is a real failure; stop early.
    if (res.status !== 404) break;
    await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
  }
  throw new Error(`could not fetch recording (${lastStatus}) after ${attempts} attempts`);
}
