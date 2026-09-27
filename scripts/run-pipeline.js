#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { runPipeline } from '../src/pipeline.js';
import { config, requireEnv } from '../src/config.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].replace(/^--/, '').split('=');
    args[key] = inline ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i]);
  }
  return args;
}

const MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
};

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  console.error(
    'Usage: node scripts/run-pipeline.js --file fixtures/sample-call.wav [--mode transfer|intake|try-it] [--tenant demo] [--json]',
  );
  process.exit(1);
}

requireEnv('GROQ_API_KEY', 'ANTHROPIC_API_KEY');

const buffer = readFileSync(args.file);
const ext = extname(args.file).toLowerCase();

const result = await runPipeline({
  tenant: { slug: args.tenant || config.defaultTenantSlug },
  callId: `local-${Date.now()}`,
  mode: args.mode || 'try-it',
  audio: {
    buffer,
    filename: basename(args.file),
    mimetype: MIME[ext] || 'application/octet-stream',
  },
});

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const { transcript, brief, timings, valid, attempts, error, warnings } = result;
  console.log('\n─── TRANSCRIPT ' + '─'.repeat(55));
  console.log(transcript.text || '(empty)');
  console.log('\n─── BRIEF ' + '─'.repeat(60));
  console.log(JSON.stringify(brief, null, 2));
  console.log('\n─── STATS ' + '─'.repeat(60));
  console.log(
    `valid=${valid}  attempts=${attempts}  stt=${timings.sttMs}ms  brief=${timings.briefMs}ms  total=${timings.totalMs}ms`,
  );
  for (const warning of warnings || []) console.log(`retry: ${warning}`);
  if (error) console.log(`error: ${error}`);
  console.log();
}
