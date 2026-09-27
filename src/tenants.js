import { randomBytes } from 'node:crypto';
import { config } from './config.js';

/**
 * In-memory tenant registry for stages 1-2. Stage 3 replaces the three lookups
 * with Supabase queries; every caller above this file stays unchanged.
 */
const tenants = new Map();

export function seedTenant({
  slug,
  name,
  twilioNumber = null,
  agentA = null,
  agentB = null,
  forward = null,
  greeting = 'Thanks for calling. Please describe what you need and we will put you through.',
  shareToken = randomBytes(24).toString('base64url'),
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
    shareToken,
    active,
  };
  tenants.set(slug, tenant);
  return tenant;
}

export const findTenantBySlug = (slug) => tenants.get(slug) || null;

export const findTenantByToken = (token) =>
  token ? [...tenants.values()].find((t) => t.shareToken === token) || null : null;

export const findTenantByTwilioNumber = (number) =>
  number ? [...tenants.values()].find((t) => t.twilioNumber === number) || null : null;

export const listTenants = () => [...tenants.values()];

// One tenant so the service is usable with no setup. Until stage 3 puts tenants
// in Postgres, this registry is in memory: without a pinned SHARE_TOKEN the
// token is regenerated on every restart and any link already shared stops working.
export function seedDefaultTenant() {
  if (tenants.size) return listTenants();
  seedTenant({
    slug: config.defaultTenantSlug,
    name: process.env.DEFAULT_TENANT_NAME || 'Demo Tenant',
    shareToken: config.shareToken || undefined,
  });
  return listTenants();
}
