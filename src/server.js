import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { runPipeline, nullStore } from './pipeline.js';
import { config } from './config.js';
import { tenantFromRequest, cookieOptions, COOKIE_NAME } from './auth.js';
import { findTenantBySlug } from './tenants.js';
import { renderTryItPage, renderUnauthorized } from './web/page.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Audio the STT step can actually read. Anything else is a 415, not a 500.
const ALLOWED_MIME = /^audio\/|^video\/webm$/;

export function buildServer({ logger = false, deps = {}, store = nullStore } = {}) {
  const app = Fastify({ logger, bodyLimit: MAX_UPLOAD_BYTES });

  app.register(cookie);
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.get('/health', async () => ({ ok: true }));

  // Bare domain is the link people will try first — send them at the Try-it
  // page, which explains that the token is missing rather than 404ing.
  app.get('/', async (req, reply) => {
    const tenant = tenantFromRequest(req);
    return reply.redirect(`/t/${tenant?.slug || config.defaultTenantSlug}`, 302);
  });

  // The share link: stash the token in a cookie, then redirect to the clean URL
  // so it stops riding in the address bar, referrers, and access logs.
  app.get('/t/:slug/:token', async (req, reply) => {
    const tenant = tenantFromRequest(req, req.params.token);
    if (!tenant || tenant.slug !== req.params.slug) {
      return reply.code(401).type('text/html').send(renderUnauthorized());
    }
    return reply
      .setCookie(COOKIE_NAME, tenant.shareToken, cookieOptions)
      .redirect(`/t/${tenant.slug}`, 302);
  });

  app.get('/t/:slug', async (req, reply) => {
    const tenant = tenantFromRequest(req);
    const named = findTenantBySlug(req.params.slug);
    if (!tenant || !named || tenant.id !== named.id) {
      return reply.code(401).type('text/html').send(renderUnauthorized());
    }
    return reply.type('text/html').send(renderTryItPage({ tenant }));
  });

  app.post('/api/briefs', async (req, reply) => {
    const tenant = tenantFromRequest(req);
    if (!tenant) return reply.code(401).send({ error: 'invalid or missing token' });

    let part;
    try {
      part = await req.file();
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'recording is larger than 25MB' });
      }
      throw err;
    }
    if (!part) return reply.code(400).send({ error: 'no audio file in the request' });
    if (!ALLOWED_MIME.test(part.mimetype || '')) {
      return reply.code(415).send({ error: `unsupported content type: ${part.mimetype}` });
    }

    let buffer;
    try {
      buffer = await part.toBuffer();
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'recording is larger than 25MB' });
      }
      throw err;
    }

    const mode = part.fields?.mode?.value || 'try-it';
    const callId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const result = await runPipeline({
        tenant,
        callId,
        mode,
        store,
        deps,
        audio: { buffer, filename: part.filename, mimetype: part.mimetype },
      });
      return reply.send({ callId, tenant: tenant.slug, ...result });
    } catch (err) {
      req.log?.error?.({ err, callId }, 'pipeline failed');
      return reply.code(502).send({ error: `pipeline failed: ${err.message}`, callId });
    }
  });

  return app;
}
