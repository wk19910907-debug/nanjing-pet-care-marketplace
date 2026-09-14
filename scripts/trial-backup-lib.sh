#!/usr/bin/env bash

trial_backup_write_checksums() {
  local directory=$1
  [[ -d $directory && ! -L $directory && -s $directory/orders.dump && -s $directory/minio-data.tar ]] || return 1
  (cd -- "$directory" && sha256sum orders.dump minio-data.tar > SHA256SUMS)
}

trial_backup_validate_checksums() {
  local directory=$1
  [[ -d $directory && ! -L $directory && -s $directory/SHA256SUMS ]] || return 1
  (cd -- "$directory" && sha256sum -c --status SHA256SUMS)
}

trial_backup_latest() {
  local root=$1 entry name
  [[ -d $root && ! -L $root ]] || return 1
  while IFS= read -r entry; do
    name=${entry##*/}
    if [[ $name =~ ^[0-9]{8}T[0-9]{6}Z$ && -d $entry && ! -L $entry && -f $entry/SHA256SUMS ]]; then
      printf '%s\n' "$entry"
      return 0
    fi
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -print | sort -r)
  return 1
}

# Prune only verified-name completed snapshots under the dedicated backup root.
# Never touch partial exports, symlinks, notes, or a caller-supplied parent path.
trial_backup_prune() {
  local root=$1 retain=$2 entry name index=0
  [[ -d $root && ! -L $root && $retain =~ ^[1-9][0-9]*$ ]] || return 1
  local -a completed=()
  while IFS= read -r entry; do
    name=${entry##*/}
    [[ $name =~ ^[0-9]{8}T[0-9]{6}Z$ && -d $entry && ! -L $entry && -f $entry/SHA256SUMS ]] || continue
    completed+=("$entry")
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -print | sort -r)
  for entry in "${completed[@]}"; do
    index=$((index + 1))
    if ((index > retain)); then
      [[ ${entry%/*} == "$root" ]] || return 1
      rm -r -- "$entry"
    fi
  done
}
