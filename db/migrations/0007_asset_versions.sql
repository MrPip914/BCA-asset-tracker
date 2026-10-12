-- 0007 — a version per asset, for per-record saves (DATABASE_BACKEND_PLAN.md,
-- Phase 2b).
--
-- A per-record save posts the version of each asset it changes and is refused
-- only when THAT asset moved. That is safe only if EVERY writer moves the
-- version: the per-record save, a full-snapshot save from an older build, the
-- Claude connector's functions (0006), the importer, a hand edit. So the bump
-- lives in triggers rather than in any one writer's code -- a writer that
-- forgot would otherwise be a silent overwrite.
--
--   - assets: a BEFORE UPDATE row trigger bumps `rev` when the row's CONTENT
--     changes. Not `position`: that shifts for every later asset whenever an
--     earlier one is deleted, and is order, not content.
--   - every child table: AFTER statement triggers, one per event, bump each
--     owning asset once per statement from the transition tables. A row moved
--     between owners bumps both.
--
-- Only inequality is ever compared, so a bump of more than one is harmless.

set search_path = asset_tracker;

alter table assets add column rev bigint not null default 0;

create function asset_rev_on_update() returns trigger
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
begin
  if new.rev = old.rev
     and (new.data, new.label, new.tag, new.type, new.parent_id)
         is distinct from (old.data, old.label, old.tag, old.type, old.parent_id) then
    new.rev := old.rev + 1;
  end if;
  return new;
end $$;

create trigger asset_rev_on_update before update on assets
  for each row execute function asset_rev_on_update();

-- TG_ARGV[0] names the child table's owner column.
create function asset_rev_from_children() returns trigger
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  owner text := TG_ARGV[0];
begin
  -- An update names both sides, so a child moved between owners bumps both;
  -- the union keeps an owner from being bumped twice by one statement.
  execute format(
    'update assets a set rev = a.rev + 1 from (%s) c where a.tenant_id = c.tenant_id and a.id = c.owner',
    case TG_OP
      when 'INSERT' then format('select tenant_id, %1$I as owner from new_rows', owner)
      when 'DELETE' then format('select tenant_id, %1$I as owner from old_rows', owner)
      else format('select tenant_id, %1$I as owner from new_rows union select tenant_id, %1$I from old_rows', owner)
    end);
  return null;
end $$;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('comments', 'asset_id'), ('allocations', 'asset_id'), ('changes', 'asset_id'),
    ('maintenance', 'asset_id'), ('breakers', 'panel_id'), ('circuits', 'panel_id'),
    ('space_links', 'plan_asset_id'), ('space_groups', 'plan_asset_id')
  ) as v(tbl, owner) loop
    execute format('create trigger %1$s_rev_ins after insert on %1$I referencing new table as new_rows
      for each statement execute function asset_rev_from_children(%2$L)', t.tbl, t.owner);
    execute format('create trigger %1$s_rev_upd after update on %1$I referencing old table as old_rows new table as new_rows
      for each statement execute function asset_rev_from_children(%2$L)', t.tbl, t.owner);
    execute format('create trigger %1$s_rev_del after delete on %1$I referencing old table as old_rows
      for each statement execute function asset_rev_from_children(%2$L)', t.tbl, t.owner);
  end loop;
end $$;
