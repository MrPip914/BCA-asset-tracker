#!/usr/bin/env bash
# Dumps the asset_tracker schema of $DATABASE_URL to an ENCRYPTED file.
#
#   DATABASE_URL=postgres://… BACKUP_PASSPHRASE=… db/backup.sh <out-dir>
#
# Writes two files into <out-dir>:
#   asset-tracker.dump.gpg   pg_dump custom format, encrypted (gpg, AES-256,
#                            symmetric, BACKUP_PASSPHRASE). The repo is public and
#                            so are its Actions artifacts to any signed-in GitHub
#                            user: the plaintext dump never leaves this script.
#   counts.tsv               "<table>\t<rows>" per table, taken before AND after
#                            the dump. If anything was written meanwhile the file
#                            holds the single line "busy" instead, and the restore
#                            check then skips the exact comparison.
#
# Only the asset_tracker schema: it is the whole app (db/migrations creates
# nothing anywhere else), and Supabase's own schemas are not ours to restore.
#
# Never echoes $DATABASE_URL or the passphrase. CI logs here are public.

set -euo pipefail

out="${1:?usage: db/backup.sh <out-dir>}"
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
mkdir -p "$out"

counts() {
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL'
select format('select %L, count(*) from asset_tracker.%I', c.relname, c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'asset_tracker' and c.relkind in ('r', 'p')
order by c.relname
\gexec
SQL
}

umask 077
plain="$(mktemp -d)"
trap 'rm -rf "$plain"' EXIT

before="$(counts)"
pg_dump "$DATABASE_URL" --format=custom --schema=asset_tracker --file="$plain/dump"
after="$(counts)"

# Fails here, not at restore time, if the dump is not something pg_restore reads.
pg_restore --list "$plain/dump" > /dev/null

gpg --batch --yes --quiet --pinentry-mode loopback \
    --passphrase-fd 3 --symmetric --cipher-algo AES256 \
    --output "$out/asset-tracker.dump.gpg" "$plain/dump" \
    3<<<"$BACKUP_PASSPHRASE"

if [ "$before" = "$after" ]; then
  printf '%s\n' "$after" > "$out/counts.tsv"
else
  echo busy > "$out/counts.tsv"
fi

size="$(stat -c %s "$out/asset-tracker.dump.gpg")"
echo "✓ Backed up $(printf '%s\n' "$after" | wc -l) tables, $size bytes encrypted."
