-- 0009 — the Claude connector's set_plan_walls (supabase/functions/mcp/).
--
-- The Map tab's Walls setup, for several walls at once: give each named Wall
-- asset its complete set of edges on one plan, and take others off it. An edge
-- is a space_links row whose shape id carries the segment suffix
-- (<spaceGid>#e<edge>[.<run>]) and whose roomId is the wall, the same row the
-- app writes, so there is nothing new to store.
--
-- New walls (and renames) and the audit rows go through connector_apply
-- (0007), which also checks the role and takes the assets revision, so this
-- whole change is one transaction on one revision. Which edges are OUTSIDE
-- edges is geometry, decided in JS by the app's own rule
-- (floorPlanExteriorSegments); what lives here is what must hold whatever JS
-- sent:
--
--   1. the plan's asset is live; every wall named is a Wall (one being set is
--      live too);
--   2. every named wall's old edges on this plan go before the new ones come
--      in, and an edge still owned by any OTHER row is refused, never taken --
--      the app's floorPlanSetWallSegments rule, and the table's own key;
--   3. each edge row is stamped now, by the person's name "(via Claude)".

set search_path = asset_tracker;

create function connector_set_plan_walls(
  p_email text, p_expected jsonb, p_plan_asset_id text, p_ops jsonb, p_walls jsonb, p_removes jsonb
) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  now_  text := connector_now();
  out   jsonb;
  w     jsonb;
  wid   text;
  seg   text;
  wtype text;
  n     integer;
begin
  if jsonb_typeof(p_walls) is distinct from 'array' or jsonb_typeof(p_removes) is distinct from 'array'
     or jsonb_array_length(p_walls) + jsonb_array_length(p_removes) = 0 then
    raise exception 'connector: The wall change was malformed.';
  end if;

  -- The role check, the revision, any new walls and every audit row.
  out := connector_apply(p_email, p_expected, p_ops);
  perform connector_live_asset(p_plan_asset_id);

  for wid in
    select value #>> '{}' from jsonb_array_elements(p_removes)
    union all
    select value ->> 'wallId' from jsonb_array_elements(p_walls)
  loop
    select type into wtype from assets where tenant_id = current_tenant() and id = wid;
    if not found then
      raise exception 'connector: No such asset (%).', wid;
    end if;
    if wtype is distinct from 'Wall' then
      raise exception 'connector: % is not a wall.', wid;
    end if;
    delete from space_links
      where tenant_id = current_tenant() and plan_asset_id = p_plan_asset_id
        and data ->> 'roomId' = wid and shape_id ~ '#e[0-9]+(\.[0-9]+)?$';
  end loop;

  select coalesce(max(position), -1) + 1 into n from space_links
    where tenant_id = current_tenant() and plan_asset_id = p_plan_asset_id;
  for w in select value from jsonb_array_elements(p_walls) loop
    wid := w ->> 'wallId';
    perform connector_live_asset(wid);
    if jsonb_typeof(w -> 'segmentIds') is distinct from 'array' or jsonb_array_length(w -> 'segmentIds') = 0 then
      raise exception 'connector: A wall had no edges.';
    end if;
    for seg in select value #>> '{}' from jsonb_array_elements(w -> 'segmentIds') loop
      if coalesce(seg, '') !~ '^.+#e[0-9]+(\.[0-9]+)?$' then
        raise exception 'connector: A wall edge was malformed.';
      end if;
      if exists (select 1 from space_links where tenant_id = current_tenant()
                 and plan_asset_id = p_plan_asset_id and shape_id = seg) then
        raise exception 'connector: The edge % already belongs to another wall. Nothing was written.', seg;
      end if;
      insert into space_links (tenant_id, plan_asset_id, shape_id, position, data)
        values (current_tenant(), p_plan_asset_id, seg, n,
          jsonb_build_object('shapeId', seg, 'roomId', wid, 'at', now_, 'by', actor));
      n := n + 1;
    end loop;
  end loop;

  return out;
end
$$;

revoke all on function connector_set_plan_walls(text, jsonb, text, jsonb, jsonb, jsonb) from public;
grant execute on function connector_set_plan_walls(text, jsonb, text, jsonb, jsonb, jsonb) to asset_api;
