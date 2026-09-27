import { readFileSync } from 'node:fs';

// Minimal .env loader — avoids a dependency and Node-version-specific flags.
// Existing process.env always wins, so Render's dashboard vars are untouched.
function loadDotEnv(path = '.env') {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    // Skip blanks so a placeholder line in a copied .env.example can't shadow a
    // real value set later in the file or in the shell.
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

export const config = {
  groqApiKey: process.env.GROQ_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  sttModel: process.env.STT_MODEL || 'whisper-large-v3-turbo',
  briefModel: process.env.BRIEF_MODEL || 'claude-sonnet-4-6',
  briefEffort: process.env.BRIEF_EFFORT || 'medium',
  // Pin this in any deployed environment; see seedDefaultTenant().
  shareToken: process.env.SHARE_TOKEN || process.env.DEV_SHARE_TOKEN || null,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  // Signature checks need the auth token; skip only when explicitly asked (tests,
  // or poking at the endpoints by hand before Twilio is wired up).
  skipTwilioValidation:
    process.env.SKIP_TWILIO_VALIDATION === "true" || !process.env.TWILIO_AUTH_TOKEN,
  defaultTenantSlug: process.env.DEFAULT_TENANT_SLUG || 'demo',
};

// Fail fast at boot, not per-request (CLAUDE.md edge cases).
export function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`,
    );
  }
}
