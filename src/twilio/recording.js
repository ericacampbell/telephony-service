import { config } from '../config.js';

/**
 * Twilio's RecordingUrl needs Basic auth, and the media lags the callback —
 * a 404 right after the webhook is normal, not fatal. Retry with backoff.
 */
export async function fetchRecording(recordingUrl, { attempts = 5, baseDelayMs = 400 } = {}) {
  // Only Twilio's own media needs our credentials — never send them to a host
  // that merely turned up in a webhook payload.
  const isTwilioHost = /(^|\.)twilio\.com$/i.test(new URL(recordingUrl).hostname);
  if (isTwilioHost && (!config.twilioAccountSid || !config.twilioAuthToken)) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set');
  }
  const headers = isTwilioHost
    ? {
        Authorization: `Basic ${Buffer.from(
          `${config.twilioAccountSid}:${config.twilioAuthToken}`,
        ).toString('base64')}`,
      }
    : {};
  const url = isTwilioHost && !recordingUrl.endsWith('.wav') ? `${recordingUrl}.wav` : recordingUrl;

  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(url, { headers });
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
