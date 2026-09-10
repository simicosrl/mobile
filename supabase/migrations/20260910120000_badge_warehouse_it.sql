-- A shared badge for the Italian warehouse, rather than one tied to a person:
-- whoever is on shift signs in with it and the country is decided server-side,
-- same as every other badge.
--
-- `on conflict` is mandatory here, not stylistic — this repo's CI has no
-- applied-migrations tracking, so every file is replayed on each [dbcheck]
-- push. A bare insert would succeed once and then abort every later run.
insert into admin.badge_countries (badge_id, country, label)
values ('BADGE-WAREHOUSE-IT', 'IT', 'Warehouse Italia')
on conflict (badge_id) do update set country = excluded.country, label = excluded.label;
