// The importer's half of snapshot-rows. The code lives with the API
// (supabase/functions/_shared/), because a save turns the same snapshot into
// the same rows -- one copy, so an import and a save cannot store a record
// differently. Only a path under supabase/functions/ is bundled into a deploy.
export { snapshotToRows } from "../supabase/functions/_shared/snapshot-rows.mjs";
