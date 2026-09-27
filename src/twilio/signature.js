import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate X-Twilio-Signature: HMAC-SHA1 over the full URL with POST params
 * appended in sorted key order. Implemented here rather than pulling the Twilio
 * SDK in for one function.
 */
export function isValidTwilioSignature({ authToken, url, params = {}, signature }) {
  if (!authToken || !signature) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Twilio signs the URL it called. Behind Render's proxy the request looks like
 * http on an internal host, so rebuild it from the forwarded headers.
 */
export function publicUrlFor(req) {
  if (process.env.PUBLIC_URL) {
    return new URL(req.url, process.env.PUBLIC_URL).toString();
  }
  const proto = req.headers['x-forwarded-proto']?.split(',')[0] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.url}`;
}
