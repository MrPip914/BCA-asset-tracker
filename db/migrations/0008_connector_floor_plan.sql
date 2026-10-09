-- 0008 — the Claude connector's replace_floor_plan (supabase/functions/mcp/).
--
-- The app's Replace on the Map tab, as one function: point an asset at a new
-- plan file and rewrite its space links and groups in the same transaction.
-- The file itself is already at the host (the connector uploads it first,
-- bytes before the row, as the app does), and the links were carried onto the
-- new plan's shapes in JS by the app's own rule (floorPlanRemapLinksAndGroups).
-- What lives here is what must hold whatever JS sent:
--
--   1. the caller is an editor on this tenant (connector_actor, 0006);
--   2. the asset is live and the inventory has not moved since JS read it
--      (connector_take_revision, 0007) -- links are the assets domain, as in
--      the app's own save;
--   3. the url is the host's (https://res.cloudinary.com/), never anything else;
--   4. one link per shape and every link naming a room, as the table and the
--      app keep it; a group has an id and at least two members;
--   5. the audit row is stamped now, by the person's name "(via Claude)".

set search_path = asset_tracker;

create function connector_replace_floor_plan(
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
       or jsonb_array_length(g->'memberShapeIds') < 2 then
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

  return jsonb_build_object('revision', rev_a);
end
$$;

revoke all on function connector_replace_floor_plan(text, jsonb, text, jsonb, jsonb, jsonb) from public;
grant execute on function connector_replace_floor_plan(text, jsonb, text, jsonb, jsonb, jsonb) to asset_api;
