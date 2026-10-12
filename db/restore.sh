#!/usr/bin/env bash
# Restores an encrypted backup made by db/backup.sh.
#
#   DATABASE_URL=… BACKUP_PASSPHRASE=… db/restore.sh --check   <backup-dir>
#   DATABASE_URL=… BACKUP_PASSPHRASE=… db/restore.sh --replace <backup-dir>
#
# --check    restores into an EMPTY throwaway database and compares every table's
#            row count with the counts.tsv taken when the backup was made. This is
#            the restore drill: a backup that has never been restored is a hope.
#            Owners and grants are skipped, since a throwaway Postgres does not
#            have Supabase's roles.
# --replace  DROPS the asset_tracker schema in $DATABASE_URL and restores the
#            backup in its place, grants included, in ONE transaction: it lands
#            whole or not at all. Everything saved since the backup is lost.
#
# Never echoes $DATABASE_URL or the passphrase. CI logs here are public.

set -euo pipefail

mode="${1:-}"; dir="${2:-}"
case "$mode" in --check|--replace) ;; *) echo "usage: db/restore.sh --check|--replace <backup-dir>" >&2; exit 2 ;; esac
[ -n "$dir" ] || { echo "usage: db/restore.sh --check|--replace <backup-dir>" >&2; exit 2; }
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

umask 077
plain="$(mktemp -d)"
trap 'rm -rf "$plain"' EXIT

gpg --batch --yes --quiet --pinentry-mode loopback \
    --passphrase-fd 3 --decrypt \
    --output "$plain/dump" "$dir/asset-tracker.dump.gpg" \
    3<<<"$BACKUP_PASSPHRASE"

psql_() { PGOPTIONS="-c client_min_messages=warning" psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q "$@"; }

if [ "$mode" = "--check" ]; then
  if [ -n "$(psql_ -At -c "select 1 from pg_namespace where nspname = 'asset_tracker'")" ]; then
    echo "✗ --check needs an empty database, and this one already has asset_tracker." >&2
    exit 1
  fi
  # Policies and grants name this role; it is cluster-wide, so it may exist.
  psql_ -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'asset_api') then create role asset_api nologin; end if; end \$\$"
  pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
    --dbname="$DATABASE_URL" "$plain/dump"
else
  { echo "drop schema if exists asset_tracker cascade;"
    pg_restore --no-owner --file=- "$plain/dump"
  } | psql_ --single-transaction
fi

restored="$(psql_ -At -F $'\t' <<'SQL'
select format('select %L, count(*) from asset_tracker.%I', c.relname, c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'asset_tracker' and c.relkind in ('r', 'p')
order by c.relname
\gexec
SQL
)"
expected="$(cat "$dir/counts.tsv")"

echo "Rows per table after the restore:"
printf '%s\n' "$restored" | sed 's/^/  /'

if [ "$expected" = "busy" ]; then
  echo "· The database was written to while this backup was taken, so counts are not compared exactly."
  [ -n "$restored" ] || { echo "✗ The restore produced no tables." >&2; exit 1; }
elif [ "$restored" != "$expected" ]; then
  echo "✗ Row counts differ from the ones recorded when the backup was made:" >&2
  diff <(printf '%s\n' "$expected") <(printf '%s\n' "$restored") >&2 || true
  exit 1
fi
echo "✓ Restore ${mode#--} passed."
