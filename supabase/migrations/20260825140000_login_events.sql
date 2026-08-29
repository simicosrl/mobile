-- Audit trail of badge logins — who logged in, from what IP, and when —
-- surfaced in the app under Settings so the office can see badge usage
-- without needing separate database access. Recorded server-side (the
-- edge function reads the real client IP off the request itself) rather
-- than trusting anything the client reports, since a phone could otherwise
-- just claim any IP it likes.
create table if not exists admin.login_events (
  id uuid primary key default gen_random_uuid(),
  badge_id text not null,
  operator_name text,
  country text not null check (country in ('IT', 'FR', 'DE')),
  ip text,
  logged_in_at timestamptz not null default now()
);
create index if not exists login_events_country_idx on admin.login_events (country, logged_in_at desc);
alter table admin.login_events enable row level security;
grant select, insert on admin.login_events to service_role;
