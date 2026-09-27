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
 * No-database fallback: one tenant so the service is usable with nothing set up.
 * Without a pinned SHARE_TOKEN the token is regenerated on every restart and any
 * link already shared stops working — which is why stage 3 moves this to Postgres.
 */
export async function seedDefaultTenant() {
  if (hasDb()) return listTenants();
  if (!memory.size) {
    seedTenant({
      slug: config.defaultTenantSlug,
      name: process.env.DEFAULT_TENANT_NAME || 'Demo Tenant',
      shareToken: config.shareToken || undefined,
    });
  }
  return [...memory.values()];
}
