-- Centralizes badge -> country assignment server-side, so operators can no
-- longer pick/change their own country in the app — a badge's country is a
-- fact of the system, looked up on every login. `active` mirrors the
-- admin.scanner_keys convention (revoke without losing history).
--
-- IMPORTANT for every future one-line "add/update this badge" migration:
-- this file gets replayed on EVERY [dbcheck] push (no applied-migrations
-- tracking in this repo's CI). A plain `insert` here would succeed once and
-- then hard-fail (aborting the rest of that CI run, including the edge
-- function deploy) on every subsequent push. Always use
-- `insert ... on conflict (badge_id) do update ...`, never a bare insert.

create table if not exists admin.badge_countries (
  badge_id text primary key,
  country text not null check (country in ('IT', 'FR', 'DE')),
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table admin.badge_countries enable row level security;
grant select, insert, update, delete on admin.badge_countries to service_role;

-- Seed the existing real tester so this doesn't lock them out the moment it ships.
insert into admin.badge_countries (badge_id, country, label)
values ('BADGE-IONUT', 'IT', 'Staicu Ionut')
on conflict (badge_id) do update set country = excluded.country, label = excluded.label;
