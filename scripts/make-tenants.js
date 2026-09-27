#!/usr/bin/env node
/**
 * Generate the TENANTS env var for a no-database deployment, with a fresh
 * share token per tenant, and print the link for each.
 *
 *   node scripts/make-tenants.js acme globex
 *   node scripts/make-tenants.js acme --twilio-acme +15550001111
 */
import '../src/config.js';
import { newShareToken, tenantsFromEnv } from '../src/tenants.js';

const argv = process.argv.slice(2);
const slugs = [];
const opts = {};

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg.startsWith('--')) opts[arg.slice(2)] = argv[++i];
  else slugs.push(arg);
}

if (!slugs.length) {
  console.error(`Usage: node scripts/make-tenants.js <slug> [<slug>...]
       [--name-<slug> "Acme Ltd"] [--twilio-<slug> +15550001111]
       [--agent-a-<slug> +1...] [--agent-b-<slug> +1...] [--forward-<slug> +1...]
       [--base https://your-service.onrender.com]`);
  process.exit(1);
}

const base = opts.base || process.env.PUBLIC_URL || 'http://localhost:3000';

const tenants = slugs.map((slug) => {
  const t = { slug, name: opts[`name-${slug}`] || slug, shareToken: newShareToken() };
  for (const [key, field] of [
    ['twilio', 'twilioNumber'],
    ['agent-a', 'agentA'],
    ['agent-b', 'agentB'],
    ['forward', 'forward'],
  ]) {
    if (opts[`${key}-${slug}`]) t[field] = opts[`${key}-${slug}`];
  }
  return t;
});

const json = JSON.stringify(tenants);
tenantsFromEnv(json); // fail here rather than at boot on Render

console.log(`\nPaste this into Render as the TENANTS environment variable (one line):\n`);
console.log(json);
console.log(`\nShare links — each one is that tenant's whole credential:\n`);
for (const t of tenants) console.log(`  ${t.name.padEnd(14)} ${base}/t/${t.slug}/${t.shareToken}`);
console.log(`
Keep a copy: the tokens are not stored anywhere else, and re-running this
command generates new ones, which invalidates every link already handed out.
`);
