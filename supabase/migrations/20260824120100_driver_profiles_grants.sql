-- The new driver_profiles tables weren't granted to service_role like every
-- other table in these schemas was — RLS being enabled with zero policies
-- already blocks anon/authenticated, but service_role additionally needs an
-- explicit GRANT here (it doesn't automatically get table privileges just
-- because it can bypass RLS).
grant select, insert, update, delete on wh_it.driver_profiles to service_role;
grant select, insert, update, delete on wh_fr.driver_profiles to service_role;
grant select, insert, update, delete on wh_de.driver_profiles to service_role;
