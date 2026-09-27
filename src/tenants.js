import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { getSql, hasDb } from './db.js';

/**
 * Tenant lookups. Backed by Postgres when DATABASE_URL is set, otherwise by an
 * in-memory map so the service still runs with no database (and so the tests
 * don't need one). Both paths return the same shape.
 */
const memory = new Map();

const fromRow = (row) =>
  row && {
    id: row.id,
    slug: row.slug,
    name: row.name,
    twilioNumber: row.twilio_number,
    agentA: row.agent_a_number,
    agentB: row.agent_b_number,
    forward: row.forward_number,
    greeting: row.greeting,
    promptOverrides: row.prompt_overrides || {},
    shareToken: row.share_token,
    active: row.active,
  };

export const newShareToken = () => randomBytes(24).toString('base64url');

export function seedTenant({
  slug,
  name,
  twilioNumber = null,
  agentA = null,
  agentB = null,
  forward = null,
  greeting = 'Thanks for calling. Please describe what you need and we will put you through.',
  shareToken = newShareToken(),
  active = true,
}) {
  const tenant = {
    id: `ten_${slug}`,
    slug,
    name: name || slug,
    twilioNumber,
    agentA,
    agentB,
    forward,
    greeting,
    promptOverrides: {},
    shareToken,
    active,
  };
  memory.set(slug, tenant);
  return tenant;
}

export async function findTenantBySlug(slug) {
  if (!slug) return null;
  if (!hasDb()) return memory.get(slug) || null;
  const sql = getSql();
  const [row] = await sql`select * from tenants where slug = ${slug} and active limit 1`;
  return fromRow(row) || null;
}

export async function findTenantByToken(token) {
  if (!token) return null;
  if (!hasDb()) return [...memory.values()].find((t) => t.shareToken === token) || null;
  const sql = getSql();
  const [row] = await sql`select * from tenants where share_token = ${token} and active limit 1`;
  return fromRow(row) || null;
}

export async function findTenantByTwilioNumber(number) {
  if (!number) return null;
  if (!hasDb()) return [...memory.values()].find((t) => t.twilioNumber === number) || null;
  const sql = getSql();
  const [row] = await sql`select * from tenants where twilio_number = ${number} and active limit 1`;
  return fromRow(row) || null;
}

export async function listTenants() {
  if (!hasDb()) return [...memory.values()];
  const sql = getSql();
  const rows = await sql`select * from tenants where active order by created_at`;
  return rows.map(fromRow);
}

/**
 * No-database tenants, from the TENANTS env var: a JSON array of
 *   {slug, name?, shareToken, twilioNumber?, agentA?, agentB?, forward?, greeting?}
 *
 * Tokens must be supplied here. A generated token would be regenerated on every
 * restart, and Render's free tier restarts on its own — so links handed out
 * before a restart would 401 afterwards with no visible cause.
 */
export function tenantsFromEnv(raw = process.env.TENANTS) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`TENANTS is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('TENANTS must be a JSON array');

  const seenTokens = new Set();
  const seenSlugs = new Set();
  const seenNumbers = new Set();
  return parsed.map((t, i) => {
    if (!t.slug) throw new Error(`TENANTS[${i}] has no slug`);
    if (!t.shareToken) throw new Error(`TENANTS[${i}] (${t.slug}) has no shareToken`);
    // A duplicate token would silently hand one tenant another's data.
    if (seenTokens.has(t.shareToken)) throw new Error(`TENANTS[${i}] (${t.slug}) reuses a shareToken`);
    if (seenSlugs.has(t.slug)) throw new Error(`TENANTS[${i}] reuses the slug ${t.slug}`);
    // Inbound calls resolve the tenant by the number dialled, so a shared
    // twilioNumber would route every call to whichever tenant was listed first.
    if (t.twilioNumber && seenNumbers.has(t.twilioNumber)) {
      throw new Error(
        `TENANTS[${i}] (${t.slug}) reuses twilioNumber ${t.twilioNumber} — ` +
          'inbound calls resolve the tenant by this number, so it must be unique',
      );
    }
    seenTokens.add(t.shareToken);
    seenSlugs.add(t.slug);
    if (t.twilioNumber) seenNumbers.add(t.twilioNumber);
    return t;
  });
}

/**
 * Tenants at boot. Postgres when DATABASE_URL is set; otherwise TENANTS, and
 * failing that a single tenant from SHARE_TOKEN so the service still runs.
 */
export async function seedDefaultTenant() {
  if (hasDb()) return listTenants();
  if (memory.size) return [...memory.values()];

  const configured = tenantsFromEnv();
  if (configured.length) {
    for (const t of configured) seedTenant(t);
  } else {
    seedTenant({
      slug: config.defaultTenantSlug,
      name: process.env.DEFAULT_TENANT_NAME || 'Demo Tenant',
      shareToken: config.shareToken || undefined,
    });
  }
  return [...memory.values()];
}
