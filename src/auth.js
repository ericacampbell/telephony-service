import { findTenantByToken } from './tenants.js';

export const COOKIE_NAME = 'tenant_token';

// One credential, four places it can ride: the link path, ?k=, a header for
// scripts, or the cookie the link sets on first load.
export function tokenFromRequest(req, pathToken) {
  return (
    pathToken ||
    req.query?.k ||
    req.headers['x-api-token'] ||
    req.cookies?.[COOKIE_NAME] ||
    null
  );
}

export async function tenantFromRequest(req, pathToken) {
  const token = tokenFromRequest(req, pathToken);
  const tenant = await findTenantByToken(token);
  if (!tenant || !tenant.active) return null;
  return tenant;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
  secure: process.env.NODE_ENV === 'production',
};
