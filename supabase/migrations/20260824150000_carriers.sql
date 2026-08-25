-- Per-country carrier list, now database-backed instead of a hardcoded
-- client-side array — lets an operator add a new carrier or attach a
-- tracking-code validation rule (e.g. "UPS codes must start with 1Z")
-- without an app rebuild, shared across every device logged into that
-- country. `pattern` is a simple required-prefix string (case-insensitive
-- match against the scanned code), not a full regex — matches the concrete
-- use case this was built for and avoids needing regex literacy in a
-- warehouse settings screen. NULL/empty pattern = no restriction.

create table if not exists wh_it.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text generated always as (lower(name)) stored unique,
  pattern text,
  created_at timestamptz not null default now()
);
alter table wh_it.carriers enable row level security;
grant select, insert, update, delete on wh_it.carriers to service_role;

create table if not exists wh_fr.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text generated always as (lower(name)) stored unique,
  pattern text,
  created_at timestamptz not null default now()
);
alter table wh_fr.carriers enable row level security;
grant select, insert, update, delete on wh_fr.carriers to service_role;

create table if not exists wh_de.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text generated always as (lower(name)) stored unique,
  pattern text,
  created_at timestamptz not null default now()
);
alter table wh_de.carriers enable row level security;
grant select, insert, update, delete on wh_de.carriers to service_role;

-- Seed each country with the carriers the app already shipped with
-- (previously a hardcoded client-side list, lib/carriers.js
-- CARRIERS_BY_COUNTRY) — `do nothing` so re-running this never clobbers a
-- pattern someone's already set on one of these.
insert into wh_it.carriers (name) values
  ('SDA'), ('BRT'), ('DHL'), ('UPS'), ('GLS'), ('TNT'), ('FEDEX'), ('AMAZON'), ('OTHER')
on conflict (name_lower) do nothing;

insert into wh_fr.carriers (name) values
  ('COLISSIMO'), ('CHRONOPOST'), ('DHL'), ('UPS'), ('GLS'), ('DPD'), ('FEDEX'), ('AMAZON'), ('OTHER')
on conflict (name_lower) do nothing;

insert into wh_de.carriers (name) values
  ('DHL'), ('HERMES'), ('DPD'), ('GLS'), ('UPS'), ('FEDEX'), ('AMAZON'), ('OTHER')
on conflict (name_lower) do nothing;
