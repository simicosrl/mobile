insert into admin.badge_countries (badge_id, country, label)
values ('BADGE-AMELIE', 'FR', 'Amelie')
on conflict (badge_id) do update set country = excluded.country, label = excluded.label;
