#!/usr/bin/env node
import '../src/config.js';
import { getSql, closeDb } from '../src/db.js';
import { newShareToken } from '../src/tenants.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].replace(/^--/, '').split('=');
    args[key] = inline ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.slug) {
  console.error(`Usage:
  node scripts/seed-tenant.js --slug acme [--name "Acme Ltd"]
      [--twilio +15550001111] [--agent-a +15550002222] [--agent-b +15550003333]
      [--forward +15550004444] [--greeting "..."] [--token <existing>] [--rotate]

  --rotate  issue a new share token for an existing tenant (old links stop working)`);
  process.exit(1);
}

const sql = getSql();
if (!sql) {
  console.error('DATABASE_URL is not set. Add the Supabase session-pooler URI to .env.');
  process.exit(1);
}

const token = args.rotate ? newShareToken() : args.token || newShareToken();

const [tenant] = await sql`
  insert into tenants (slug, name, twilio_number, agent_a_number, agent_b_number,
                       forward_number, greeting, share_token)
  values (
    ${args.slug},
    ${args.name || args.slug},
    ${args.twilio || null},
    ${args['agent-a'] || null},
    ${args['agent-b'] || null},
    ${args.forward || null},
    ${args.greeting || 'Thanks for calling. Please describe what you need and we will put you through.'},
    ${token}
  )
  on conflict (slug) do update set
    name           = excluded.name,
    twilio_number  = coalesce(excluded.twilio_number,  tenants.twilio_number),
    agent_a_number = coalesce(excluded.agent_a_number, tenants.agent_a_number),
    agent_b_number = coalesce(excluded.agent_b_number, tenants.agent_b_number),
    forward_number = coalesce(excluded.forward_number, tenants.forward_number),
    greeting       = excluded.greeting,
    -- Only replace the token when --rotate was passed; re-running the seed must
    -- not silently break links that are already out there.
    share_token    = case when ${Boolean(args.rotate)} then excluded.share_token
                          else tenants.share_token end,
    active         = true
  returning *`;

const base = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

console.log(`
Tenant:      ${tenant.name}  (${tenant.slug})
Id:          ${tenant.id}
Twilio:      ${tenant.twilio_number || '— not set'}
Agent A/B:   ${tenant.agent_a_number || '—'} / ${tenant.agent_b_number || '—'}
Forward:     ${tenant.forward_number || '—'}

Share link (this is the whole credential — treat it like a password):
  ${base}/t/${tenant.slug}/${tenant.share_token}

Headless run:
  node scripts/run-pipeline.js --tenant ${tenant.slug} --file fixtures/sample-call.wav
`);

await closeDb();
