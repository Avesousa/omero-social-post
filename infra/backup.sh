#!/usr/bin/env bash
#
# Daily PostgreSQL backup for the omero-social-post compose stack.
#
# Writes a pg_dump (custom format, compressed) to /opt/omero/backups, checks that it can be
# read back, and deletes dumps older than 14 days. Run it as the user that owns /opt/omero
# (member of the docker group). Sample cron line (`crontab -e`, daily at 03:17 server time):
#
#   17 3 * * * /opt/omero/backup.sh >> /opt/omero/backups/backup.log 2>&1
#
# Restore: see "Backups" in infra/README.md.
#
# Environment overrides: APP_DIR (default /opt/omero), BACKUP_DIR (default $APP_DIR/backups),
# RETENTION_DAYS (default 14).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/omero}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

[[ ${RETENTION_DAYS} =~ ^[1-9][0-9]*$ ]] || {
  echo "RETENTION_DAYS must be a positive integer" >&2
  exit 1
}

cd "${APP_DIR}"
umask 077
mkdir -p "${BACKUP_DIR}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/omero-${timestamp}.dump"
partial="${target}.partial"
trap 'rm -f "${partial}"' EXIT

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

log "Dumping database to ${target}"
# Credentials come from the postgres container's own environment (POSTGRES_USER/POSTGRES_DB);
# -T: no TTY, so the binary dump is not mangled.
# shellcheck disable=SC2016 # expanded inside the container, not here
docker compose exec -T postgres sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  >"${partial}"

if [[ ! -s ${partial} ]]; then
  log "ERROR: the dump is empty"
  exit 1
fi

# Integrity check: pg_restore must be able to read the archive's table of contents.
if ! docker compose exec -T postgres pg_restore --list >/dev/null <"${partial}"; then
  log "ERROR: pg_restore cannot read the dump"
  exit 1
fi

mv "${partial}" "${target}"
log "OK $(du -h "${target}" | cut -f1) ${target}"

# Keep the last RETENTION_DAYS days of dumps.
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'omero-*.dump' -mtime +"$((RETENTION_DAYS - 1))" -print -delete |
  while IFS= read -r removed; do log "Removed old dump ${removed}"; done
