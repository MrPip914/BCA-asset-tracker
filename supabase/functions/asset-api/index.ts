// Entry point for the asset-api Edge Function. Everything else is in api.ts,
// which takes its database and its Google check as arguments so api_test.ts can
// drive it against a throwaway Postgres.
//
// SUPABASE_DB_URL is provided to every Edge Function by Supabase itself. It is
// a role that bypasses RLS, which is why every query goes through withTenant
// (db.ts) and drops to asset_api first.

import postgres from "npm:postgres@3.4.5";
import { createApi } from "./api.ts";

// prepare:false because the URL may point at the transaction pooler, which
// cannot hold prepared statements across transactions.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 20 });

Deno.serve(createApi({ sql }));
