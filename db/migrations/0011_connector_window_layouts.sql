-- 0011 -- the Claude connector's replace_floor_plan accepts a Window asset.
--
-- A window's pane layout is stored exactly as a floor plan is (the asset's
-- floorPlanUrl fields, plus space_groups for its pane groups), so the same
-- function serves it. The one difference: a pane group may hold a single pane
-- (window-tracking plan), where a map group needs two. Everything else in
-- 0010's definition is unchanged.

set search_path = asset_tracker;

-- connector_replace_floor_plan (0008), with the plan asset's row and its links
-- and groups backed up first.
create or replace function connector_replace_floor_plan(
  p_email text, p_expected jsonb, p_asset_id text, p_plan jsonb, p_links jsonb, p_groups jsonb
) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  now_  text := connector_now();
  rev_a integer;
  atype text;
  l     jsonb;
  g     jsonb;
  n     integer := 0;
  bid   bigint;
begin
  rev_a := connector_take_revision('assets', (p_expected->>'assets')::integer);
  atype := connector_live_asset(p_asset_id);

  if jsonb_typeof(p_plan) is distinct from 'object'
     or coalesce(p_plan->>'url', '') !~ '^https://res\.cloudinary\.com/'
     or coalesce(trim(p_plan->>'fileName'), '') = '' then
    raise exception 'connector: The new floor plan was malformed.';
  end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_typeof(p_groups) is distinct from 'array' then
    raise exception 'connector: The floor plan links were malformed.';
  end if;

  bid := connector_backup(actor, 'replace_floor_plan', jsonb_build_array(
    jsonb_build_object('kind', 'asset', 'key', p_asset_id),
    jsonb_build_object('kind', 'plan', 'key', p_asset_id)));

  update assets set data = data || jsonb_build_object(
      'floorPlanUrl', p_plan->>'url',
      'floorPlanStorageKey', coalesce(p_plan->>'storageKey', ''),
      'floorPlanFileName', p_plan->>'fileName')
    where tenant_id = current_tenant() and id = p_asset_id;

  delete from space_links where tenant_id = current_tenant() and plan_asset_id = p_asset_id;
  delete from space_groups where tenant_id = current_tenant() and plan_asset_id = p_asset_id;

  for l in select value from jsonb_array_elements(p_links) loop
    if coalesce(l->>'shapeId', '') = '' or coalesce(l->>'roomId', '') = '' then
      raise exception 'connector: A floor plan link was malformed.';
    end if;
    if exists (select 1 from space_links where tenant_id = current_tenant()
               and plan_asset_id = p_asset_id and shape_id = l->>'shapeId') then
      raise exception 'connector: Two links name the same shape (%).', l->>'shapeId';
    end if;
    insert into space_links (tenant_id, plan_asset_id, shape_id, position, data)
      values (current_tenant(), p_asset_id, l->>'shapeId', n, l);
    n := n + 1;
  end loop;

  n := 0;
  for g in select value from jsonb_array_elements(p_groups) loop
    if coalesce(g->>'id', '') = '' or jsonb_typeof(g->'memberShapeIds') is distinct from 'array'
       or jsonb_array_length(g->'memberShapeIds') < case when atype = 'Window' then 1 else 2 end then
      raise exception 'connector: A floor plan group was malformed.';
    end if;
    insert into space_groups (tenant_id, id, plan_asset_id, position, data)
      values (current_tenant(), g->>'id', p_asset_id, n, g);
    n := n + 1;
  end loop;

  insert into audit_log (tenant_id, asset_id, at, by, action, data) values (
    current_tenant(), p_asset_id, now_, actor, 'floor_plan_replaced',
    jsonb_build_object('assetLabel', p_asset_id, 'assetType', atype, 'action', 'floor_plan_replaced',
      'to', p_plan->>'fileName', 'at', now_, 'by', actor));

  perform connector_backup_seal();
  return jsonb_build_object('revision', rev_a, 'backup', bid);
end
$$;
