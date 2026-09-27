#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/config.js';
import { getSql, closeDb } from '../src/db.js';

const sql = getSql();
if (!sql) {
  console.error('DATABASE_URL is not set. Add the Supabase session-pooler URI to .env.');
  process.exit(1);
}

// Plain forward-only migrations: run every .sql file in order, record what ran.
await sql`create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;

const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
const dir = new URL('../migrations/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`· ${file} (already applied)`);
    continue;
  }
  process.stdout.write(`→ ${file} … `);
  await sql.unsafe(readFileSync(join(dir, file), 'utf8'));
  await sql`insert into schema_migrations (name) values (${file})`;
  console.log('done');
  ran += 1;
}

console.log(ran ? `\nApplied ${ran} migration(s).` : '\nSchema already up to date.');
await closeDb();
