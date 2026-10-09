-- AURA Workspace database setup.
-- Run once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run (all statements are IF NOT EXISTS / DROP IF EXISTS).

create table if not exists public.aura_users (
  id bigint generated always as identity primary key,
  username text unique not null,
  pass_hash text not null,
  pass_salt text not null,
  totp_secret text,
  totp_enabled integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.aura_sessions (
  id text primary key,
  user_id bigint not null references public.aura_users(id) on delete cascade,
  device_label text not null default '',
  ip text not null default '',
  ua text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table if not exists public.aura_devices (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.aura_users(id) on delete cascade,
  label text not null,
  ip text not null default '',
  ua text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create table if not exists public.aura_audit (
  id bigint generated always as identity primary key,
  user_id bigint,
  action text not null,
  detail text not null default '',
  ip text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.aura_agents (
  user_id bigint primary key references public.aura_users(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  host text not null default '',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_aura_sessions_user on public.aura_sessions(user_id);
create index if not exists idx_aura_audit_action on public.aura_audit(action);

-- v0.1: permissive server-side policies (anon key stays in server env vars only).
-- Harden in 0.1.x by switching routes to service_role and locking these down.
alter table public.aura_users enable row level security;
alter table public.aura_sessions enable row level security;
alter table public.aura_devices enable row level security;
alter table public.aura_audit enable row level security;
alter table public.aura_agents enable row level security;
drop policy if exists "aura server full access" on public.aura_users;
drop policy if exists "aura server full access" on public.aura_sessions;
drop policy if exists "aura server full access" on public.aura_devices;
drop policy if exists "aura server full access" on public.aura_audit;
drop policy if exists "aura server full access" on public.aura_agents;
create policy "aura server full access" on public.aura_users for all using (true) with check (true);
create policy "aura server full access" on public.aura_sessions for all using (true) with check (true);
create policy "aura server full access" on public.aura_devices for all using (true) with check (true);
create policy "aura server full access" on public.aura_audit for all using (true) with check (true);
create policy "aura server full access" on public.aura_agents for all using (true) with check (true);
