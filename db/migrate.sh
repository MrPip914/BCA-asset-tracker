#!/usr/bin/env bash
# Applies db/migrations/*.sql, in name order, to the database in $DATABASE_URL.
#
#   DATABASE_URL=postgres://… db/migrate.sh
#
# Each file runs in ONE transaction together with the row recording it, so a
# migration either lands whole and is recorded, or does neither. A file already
# recorded is skipped — but only if it is byte-for-byte what was applied: an
# edited migration is refused, because a database that ran the old text and a
# fresh one that runs the new text would silently disagree. Change the schema
# with a NEW file instead.
#
# Never echoes $DATABASE_URL: it carries the password, and CI logs on this
# repository are public.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL is not set." >&2
  exit 1
fi

dir="$(cd "$(dirname "$0")" && pwd)/migrations"
psql_() { PGOPTIONS="-c client_min_messages=warning" psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q "$@"; }

psql_ <<'SQL'
create schema if not exists asset_tracker;
create table if not exists asset_tracker.schema_migrations (
  name       text primary key,
  sha256     text not null,
  applied_at timestamptz not null default now()
);
SQL

applied=0
for file in "$dir"/*.sql; do
  name="$(basename "$file")"
  sum="$(sha256sum "$file" | cut -d' ' -f1)"
  stored="$(psql_ -At -c "select sha256 from asset_tracker.schema_migrations where name = '$name'")"

  if [ -n "$stored" ]; then
    if [ "$stored" != "$sum" ]; then
      echo "✗ $name was edited after it was applied. Put the change in a new migration." >&2
      exit 1
    fi
    echo "· $name already applied"
    continue
  fi

  {
    cat "$file"
    echo
    echo "insert into asset_tracker.schema_migrations (name, sha256) values ('$name', '$sum');"
  } | psql_ --single-transaction
  echo "✓ $name applied"
  applied=$((applied + 1))
done

echo "Done: $applied new migration(s)."
