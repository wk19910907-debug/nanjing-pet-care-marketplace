#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=trial-backup-lib.sh
source "$script_dir/trial-backup-lib.sh"
# shellcheck source=trial-restore-lib.sh
source "$script_dir/trial-restore-lib.sh"

trial_root=${PETCARE_TRIAL_ROOT:-/opt/petcare-trial}
[[ $trial_root == /* && $trial_root != / && $trial_root != *[$'\n\t ']* && -d $trial_root ]] || {
  echo INVALID_TRIAL_ROOT; exit 2;
}
trial_root=$(realpath -e -- "$trial_root")
[[ $trial_root != / && -L $trial_root/current ]] || { echo TRIAL_NOT_ADOPTED; exit 1; }
secret_dir="$trial_root/secrets"
env_file="$secret_dir/local-production.env"
[[ -f $env_file && $(stat -c %a "$secret_dir") == 700 && $(stat -c %a "$env_file") == 600 ]] || {
  echo TRIAL_SECRET_PERMISSIONS_INVALID; exit 1;
}
release=$(realpath -e -- "$trial_root/current")
[[ $release == "$trial_root/"* ]] || { echo RELEASE_OUTSIDE_TRIAL_ROOT; exit 1; }
compose_file="$release/deploy/compose.local-production.yml"
[[ -f $compose_file ]] || { echo COMPOSE_FILE_MISSING; exit 1; }
backup_root="$trial_root/backups"
[[ -d $backup_root && ! -L $backup_root && $(stat -c %a "$backup_root") == 700 ]] || {
  echo BACKUP_PERMISSIONS_INVALID; exit 1;
}
exec 9>"$backup_root/.backup.lock"
flock -n 9 || { echo BACKUP_ALREADY_RUNNING; exit 1; }
bash "$release/scripts/trialctl.sh" verify >/dev/null
backup=$(trial_backup_latest "$backup_root") || { echo NO_COMPLETE_BACKUP; exit 1; }
trial_backup_validate_checksums "$backup" || { echo BACKUP_CHECKSUM_FAILED; exit 1; }
tar -tf "$backup/minio-data.tar" >/dev/null || { echo OBJECT_ARCHIVE_INVALID; exit 1; }
for item in orders.dump minio-data.tar; do
  [[ -f $backup/$item && ! -L $backup/$item ]] || { echo BACKUP_FILE_INVALID; exit 1; }
  bytes=$(stat -c %s "$backup/$item")
  [[ $bytes =~ ^[0-9]+$ && $bytes -le 67108864 ]] || { echo RESTORE_DRILL_SIZE_LIMIT; exit 1; }
done
free_kib=$(df -Pk "$backup_root" | awk 'NR==2 {print $4}')
[[ $free_kib =~ ^[0-9]+$ && $free_kib -ge 4194304 ]] || { echo RESTORE_DRILL_DISK_LOW; exit 1; }

compose() {
  LOCAL_PRODUCTION_SECRET_DIR="$secret_dir" docker compose --env-file "$env_file" -f "$compose_file" "$@"
}
compose exec -T postgres pg_restore -l < "$backup/orders.dump" >/dev/null || {
  echo DATABASE_ARCHIVE_INVALID; exit 1;
}

mkdir -p -m 0700 "$trial_root/state"
log="$trial_root/state/restore-drill.log"
: > "$log"
chmod 0600 "$log"
stamp=$(date -u +%Y%m%d%H%M%S)
drill_db="petcare_restore_${stamp}_$$"
drill_volume="petcare-trial-restore-${stamp}-$$"
trial_restore_valid_db "$drill_db" || { echo RESTORE_NAME_INVALID; exit 1; }
[[ $drill_volume =~ ^petcare-trial-restore-[0-9]{14}-[0-9]{1,10}$ ]] || { echo RESTORE_NAME_INVALID; exit 1; }
created_db=0
created_volume=0

cleanup() {
  local failed=0
  if ((created_volume)); then
    docker volume rm "$drill_volume" >>"$log" 2>&1 || failed=1
    created_volume=0
  fi
  if ((created_db)); then
    trial_restore_valid_db "$drill_db" || return 1
    compose exec -T -e RESTORE_DB="$drill_db" postgres sh -c \
      'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists -U "$POSTGRES_USER" "$RESTORE_DB"' \
      >>"$log" 2>&1 || failed=1
    created_db=0
  fi
  return "$failed"
}
on_exit() {
  local status=$?
  trap - EXIT
  cleanup || { echo RESTORE_CLEANUP_FAILED; exit 1; }
  exit "$status"
}
trap on_exit EXIT

compose exec -T -e RESTORE_DB="$drill_db" postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$RESTORE_DB"' \
  >>"$log" 2>&1
created_db=1
compose exec -T -e RESTORE_DB="$drill_db" postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$RESTORE_DB"' \
  < "$backup/orders.dump" >>"$log" 2>&1
table_count=$(compose exec -T -e RESTORE_DB="$drill_db" postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DB" -c "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema()"' \
  2>>"$log")
[[ $table_count =~ ^[0-9]+$ && $table_count -ge 1 ]] || { echo RESTORED_SCHEMA_EMPTY; exit 1; }

if docker volume inspect "$drill_volume" >/dev/null 2>&1; then
  echo RESTORE_VOLUME_COLLISION; exit 1
fi
docker volume create "$drill_volume" >>"$log" 2>&1
created_volume=1
image='postgres:16.10-alpine3.22@sha256:ab8380566c3ea09690a9ecaa85a59d82bfc6eb86744151a2a54335866c83a3e9'
docker run --rm --network none --read-only \
  --mount "type=bind,src=$backup/minio-data.tar,dst=/archive.tar,readonly" \
  --mount "type=volume,src=$drill_volume,dst=/restore" \
  --entrypoint tar "$image" -C /restore -xf /archive.tar >>"$log" 2>&1
docker run --rm --network none --read-only \
  --mount "type=volume,src=$drill_volume,dst=/restore,readonly" \
  --entrypoint sh "$image" -c 'test "$(find /restore -type f | wc -l)" -gt 0' >>"$log" 2>&1

cleanup || { echo RESTORE_CLEANUP_FAILED; exit 1; }
trap - EXIT
echo "RESTORE_DRILL_OK:$(basename "$backup")"
