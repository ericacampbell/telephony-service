-- Transfer Brief, schema v1.
-- Every table carries tenant_id and every query filters on it. Artifacts are
-- one row per stage so a failed stage stays visible instead of overwritten.

create extension if not exists "pgcrypto";

create table if not exists tenants (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  name              text not null,
  twilio_number     text unique,
  agent_a_number    text,
  agent_b_number    text,
  forward_number    text,
  greeting          text not null default 'Thanks for calling. Please describe what you need and we will put you through.',
  prompt_overrides  jsonb not null default '{}'::jsonb,
  share_token       text unique not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists calls (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  mode             text not null check (mode in ('transfer','intake','try-it')),
  twilio_call_sid  text,
  from_number      text,
  to_number        text,
  agent_a          text,
  agent_b          text,
  status           text not null default 'ringing'
                   check (status in ('ringing','recording','transcribing','briefing','bridged','failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Twilio retries webhooks; the same CallSid must not create a second call row.
create unique index if not exists calls_twilio_call_sid_key
  on calls (twilio_call_sid) where twilio_call_sid is not null;
create index if not exists calls_tenant_created_idx on calls (tenant_id, created_at desc);

create table if not exists recordings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  call_id      uuid not null references calls(id) on delete cascade,
  source       text not null check (source in ('twilio','upload')),
  url          text,
  duration_sec numeric,
  bytes        bigint,
  fetched_at   timestamptz not null default now()
);

create table if not exists transcripts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  call_id      uuid not null references calls(id) on delete cascade,
  recording_id uuid references recordings(id) on delete set null,
  text         text not null,
  segments     jsonb not null default '[]'::jsonb,
  language     text,
  model        text,
  latency_ms   integer,
  created_at   timestamptz not null default now()
);
create index if not exists transcripts_call_idx on transcripts (call_id, created_at desc);

create table if not exists briefs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  call_id        uuid not null references calls(id) on delete cascade,
  transcript_id  uuid references transcripts(id) on delete set null,
  brief          jsonb not null,
  model          text,
  prompt_version text,
  schema_version text,
  attempts       integer,
  latency_ms     integer,
  valid          boolean not null default false,
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists briefs_call_idx on briefs (call_id, created_at desc);

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  call_id    uuid references calls(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_call_idx on events (call_id, created_at);

-- The service connects with the service-role key and scopes every query in
-- application code. RLS is on with no permissive policy so that a leaked anon
-- key reads nothing at all.
alter table tenants     enable row level security;
alter table calls       enable row level security;
alter table recordings  enable row level security;
alter table transcripts enable row level security;
alter table briefs      enable row level security;
alter table events      enable row level security;
