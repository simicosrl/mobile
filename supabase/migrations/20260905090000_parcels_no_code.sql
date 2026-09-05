-- Lets a parcel be logged without a valid tracking code (torn/unreadable
-- label, or a code that doesn't match the carrier's required prefix) —
-- backed by a photo instead, for the office to reconcile manually. Mirrors
-- the existing damage_type/damage_photo columns.
alter table wh_it.parcels add column if not exists no_code boolean not null default false;
alter table wh_it.parcels add column if not exists no_code_note text;
alter table wh_it.parcels add column if not exists no_code_photo text;

alter table wh_fr.parcels add column if not exists no_code boolean not null default false;
alter table wh_fr.parcels add column if not exists no_code_note text;
alter table wh_fr.parcels add column if not exists no_code_photo text;

alter table wh_de.parcels add column if not exists no_code boolean not null default false;
alter table wh_de.parcels add column if not exists no_code_note text;
alter table wh_de.parcels add column if not exists no_code_photo text;
