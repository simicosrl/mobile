-- OUTBOUND DDT (delivery note).
--
-- One DDT per (session x shipment), holding exactly the tracking IDs scanned in
-- that session — never the whole shipment. A shipment can carry ~200 trackings;
-- if three of them leave today and one more leaves tomorrow, today's DDT lists
-- three and tomorrow gets its own DDT listing one.
--
-- The unique constraint on (session_id, shipment_id) is what makes that rule
-- hold mechanically: re-syncing a session cannot produce a second document for
-- the same shipment.
--
-- `fields` keeps the prep center's response verbatim. A DDT is a legal
-- transport document; if their API later changes or a value is disputed, what
-- we actually printed has to be reconstructable from what we were actually told.

create table if not exists wh_it.ddt (
  id uuid primary key default gen_random_uuid(),
  doc text not null,
  session_id uuid not null references wh_it.sessions(id) on delete cascade,
  shipment_id text not null,
  fba_id text,
  driver_name text,
  driver_plate text,
  driver_company text,
  signature text,
  fields jsonb,
  pdf text,
  created_at timestamptz not null default now(),
  unique (session_id, shipment_id)
);

create table if not exists wh_it.ddt_lines (
  id uuid primary key default gen_random_uuid(),
  ddt_id uuid not null references wh_it.ddt(id) on delete cascade,
  tracking text not null,
  boxes integer not null default 1,
  condition text,
  created_at timestamptz not null default now()
);

create index if not exists ddt_session_idx on wh_it.ddt (session_id);
create index if not exists ddt_lines_ddt_idx on wh_it.ddt_lines (ddt_id);

create table if not exists wh_fr.ddt (
  id uuid primary key default gen_random_uuid(),
  doc text not null,
  session_id uuid not null references wh_fr.sessions(id) on delete cascade,
  shipment_id text not null,
  fba_id text,
  driver_name text,
  driver_plate text,
  driver_company text,
  signature text,
  fields jsonb,
  pdf text,
  created_at timestamptz not null default now(),
  unique (session_id, shipment_id)
);

create table if not exists wh_fr.ddt_lines (
  id uuid primary key default gen_random_uuid(),
  ddt_id uuid not null references wh_fr.ddt(id) on delete cascade,
  tracking text not null,
  boxes integer not null default 1,
  condition text,
  created_at timestamptz not null default now()
);

create index if not exists ddt_session_idx on wh_fr.ddt (session_id);
create index if not exists ddt_lines_ddt_idx on wh_fr.ddt_lines (ddt_id);

create table if not exists wh_de.ddt (
  id uuid primary key default gen_random_uuid(),
  doc text not null,
  session_id uuid not null references wh_de.sessions(id) on delete cascade,
  shipment_id text not null,
  fba_id text,
  driver_name text,
  driver_plate text,
  driver_company text,
  signature text,
  fields jsonb,
  pdf text,
  created_at timestamptz not null default now(),
  unique (session_id, shipment_id)
);

create table if not exists wh_de.ddt_lines (
  id uuid primary key default gen_random_uuid(),
  ddt_id uuid not null references wh_de.ddt(id) on delete cascade,
  tracking text not null,
  boxes integer not null default 1,
  condition text,
  created_at timestamptz not null default now()
);

create index if not exists ddt_session_idx on wh_de.ddt (session_id);
create index if not exists ddt_lines_ddt_idx on wh_de.ddt_lines (ddt_id);

alter table wh_it.ddt enable row level security;
alter table wh_it.ddt_lines enable row level security;
alter table wh_fr.ddt enable row level security;
alter table wh_fr.ddt_lines enable row level security;
alter table wh_de.ddt enable row level security;
alter table wh_de.ddt_lines enable row level security;

-- RLS with no policies already blocks anon/authenticated; service_role still
-- needs the explicit grant (see 20260824120100_driver_profiles_grants.sql).
grant select, insert, update, delete on wh_it.ddt, wh_it.ddt_lines to service_role;
grant select, insert, update, delete on wh_fr.ddt, wh_fr.ddt_lines to service_role;
grant select, insert, update, delete on wh_de.ddt, wh_de.ddt_lines to service_role;

-- DDT numbering: its own series per country, restarting each year, which is how
-- Italian delivery notes are numbered and how the prep center's own documents
-- read ("DDT 209-OUT/2026"). A yearly restart can't come from a plain sequence,
-- so the counter is a row per (country, year).
create table if not exists admin.ddt_counters (
  country text not null,
  year integer not null,
  last_number bigint not null default 0,
  primary key (country, year)
);

grant select, insert, update on admin.ddt_counters to service_role;

create or replace function admin.next_ddt_number(p_country text)
returns text
language plpgsql
security definer
set search_path to 'admin', 'pg_temp'
as $function$
declare
  y integer := extract(year from now())::integer;
  n bigint;
begin
  if p_country not in ('IT', 'FR', 'DE') then
    raise exception 'unknown country %', p_country;
  end if;
  -- One statement, so two phones closing a session at the same moment cannot
  -- be handed the same number.
  insert into admin.ddt_counters (country, year, last_number)
  values (upper(p_country), y, 1)
  on conflict (country, year)
    do update set last_number = admin.ddt_counters.last_number + 1
  returning last_number into n;
  return format('DDT %s-OUT/%s', n, y);
end;
$function$;
