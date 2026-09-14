#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=trial-backup-lib.sh
source "$script_dir/trial-backup-lib.sh"

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
mkdir -p -m 0700 -- "$backup_root"
[[ ! -L $backup_root && $(stat -c %a "$backup_root") == 700 ]] || { echo BACKUP_PERMISSIONS_INVALID; exit 1; }
exec 9>"$backup_root/.backup.lock"
flock -n 9 || { echo BACKUP_ALREADY_RUNNING; exit 1; }

# Never create a backup of a stack already known to be unhealthy.
bash "$release/scripts/trialctl.sh" verify >/dev/null
free_kib=$(df -Pk "$backup_root" | awk 'NR==2 {print $4}')
[[ $free_kib =~ ^[0-9]+$ && $free_kib -ge 4194304 ]] || { echo BACKUP_DISK_LOW; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$backup_root/$stamp"
partial="$backup_root/.partial-$stamp-$$"
[[ ! -e $destination && ! -e $partial ]] || { echo BACKUP_PATH_EXISTS; exit 1; }
mkdir -m 0700 -- "$partial"
cleanup_partial() {
  if [[ -d $partial && ! -L $partial && ${partial%/*} == "$backup_root" ]]; then
    rm -r -- "$partial"
  fi
}
trap cleanup_partial EXIT

compose() {
  LOCAL_PRODUCTION_SECRET_DIR="$secret_dir" docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial/orders.dump"
compose exec -T postgres pg_restore -l < "$partial/orders.dump" >/dev/null

image='postgres:16.10-alpine3.22@sha256:ab8380566c3ea09690a9ecaa85a59d82bfc6eb86744151a2a54335866c83a3e9'
docker volume inspect nanjing-petcare-local-production_minio_data >/dev/null
docker run --rm --network none --read-only \
  --mount type=volume,src=nanjing-petcare-local-production_minio_data,dst=/data,readonly \
  --entrypoint tar "$image" -C /data -cf - . > "$partial/minio-data.tar"
tar -tf "$partial/minio-data.tar" >/dev/null
trial_backup_write_checksums "$partial"
trial_backup_validate_checksums "$partial"
printf 'utc=%s\nrelease=%s\nconsistency=near-time-not-atomic\n' "$stamp" "$(basename "$release")" > "$partial/MANIFEST"
mv -- "$partial" "$destination"
trap - EXIT
trial_backup_prune "$backup_root" 3
echo "BACKUP_OK:$stamp"
