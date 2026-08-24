-- Per-country driver profiles, so a driver's name/company/plate survive an
-- app reinstall and show up the same way on any device logged into this
-- country — previously this lived only in each phone's local IndexedDB.
-- name_lower is a real (generated, stored) column, not just an index, so
-- supabase-js .upsert(..., { onConflict: 'name_lower' }) can target it.

create table if not exists wh_it.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text generated always as (lower(name)) stored unique,
  courier_company text,
  plate text,
  last_used_at timestamptz not null default now()
);
alter table wh_it.driver_profiles enable row level security;

create table if not exists wh_fr.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text generated always as (lower(name)) stored unique,
  courier_company text,
  plate text,
  last_used_at timestamptz not null default now()
);
alter table wh_fr.driver_profiles enable row level security;

create table if not exists wh_de.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text generated always as (lower(name)) stored unique,
  courier_company text,
  plate text,
  last_used_at timestamptz not null default now()
);
alter table wh_de.driver_profiles enable row level security;
