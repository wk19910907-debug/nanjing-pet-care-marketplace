#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=trialctl-lib.sh
source "$script_dir/trialctl-lib.sh"

usage() {
  printf '%s\n' 'Usage: trialctl.sh adopt|status|verify|update <40-character commit>'
  printf '%s\n' 'update is explicit; the timer runs only read-only verification.'
}

command_name=${1:---help}
case "$command_name" in
  --help|-h) usage; exit 0 ;;
  adopt|status|verify) [[ $# -eq 1 ]] || { usage; exit 2; } ;;
  update)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    trial_valid_sha "$2" || { echo INVALID_COMMIT; exit 2; }
    ;;
  *) usage; exit 2 ;;
esac

trial_root=${PETCARE_TRIAL_ROOT:-/opt/petcare-trial}
[[ $trial_root == /* && $trial_root != / && $trial_root != *[$'\n\t ']* ]] || { echo INVALID_TRIAL_ROOT; exit 2; }
repo="$trial_root/repo"
secrets="$trial_root/secrets"
env_file="$secrets/local-production.env"
ca_file="$secrets/trial-ca.crt"
state_dir="$trial_root/state"
state_file="$state_dir/current"

require_existing() {
  [[ -d $repo && -f $env_file && -f $ca_file ]] || { echo TRIAL_PREREQUISITE_MISSING; exit 1; }
  [[ $(stat -c %a "$secrets") == 700 && $(stat -c %a "$env_file") == 600 ]] || {
    echo TRIAL_SECRET_PERMISSIONS_INVALID; exit 1;
  }
}

read_state() {
  [[ -f $state_file ]] || { echo TRIAL_NOT_ADOPTED; exit 1; }
  read -r current_sha current_release < "$state_file"
  trial_valid_sha "$current_sha" || { echo TRIAL_STATE_INVALID; exit 1; }
  [[ $current_release == "$trial_root/"* && -d $current_release ]] || {
    echo TRIAL_STATE_INVALID; exit 1;
  }
}

compose_at() {
  local release=$1
  shift
  LOCAL_PRODUCTION_SECRET_DIR="$secrets" docker compose \
    --env-file "$env_file" -f "$release/deploy/compose.local-production.yml" "$@"
}

http_status() {
  local host=$1 url=$2
  curl --silent --show-error --max-time 8 --cacert "$ca_file" \
    --resolve "$host:443:127.0.0.1" --output /dev/null --write-out '%{http_code}' "$url"
}

verify_at() {
  local release=$1 ready ports
  compose_at "$release" config --quiet >/dev/null
  ready=$(curl --fail --silent --show-error --max-time 8 --cacert "$ca_file" \
    --resolve petcare.localhost:443:127.0.0.1 https://petcare.localhost/health/ready)
  for field in ready database objectStorage encryption; do
    [[ $ready == *\"$field\":true* ]] || { echo "READINESS_FAILED:$field"; return 1; }
  done
  [[ $(http_status petcare.localhost https://petcare.localhost/health/live) == 200 ]] || {
    echo NORMAL_API_FAILED; return 1;
  }
  [[ $(http_status petcare.localhost 'https://petcare.localhost/health/live?probe=%27%20OR%201%3D1%20UNION%20SELECT%20password%20FROM%20users--') == 403 ]] || {
    echo WAF_PROBE_FAILED; return 1;
  }
  [[ $(http_status storage.petcare.localhost 'https://storage.petcare.localhost/pet-evidence?list-type=2') == 403 ]] || {
    echo PRIVATE_BUCKET_FAILED; return 1;
  }
  ports=$(docker ps --format '{{.Ports}}')
  if [[ $ports == *'0.0.0.0:'* || $ports == *'[::]:'* ]]; then
    echo PUBLIC_CONTAINER_BINDING_FOUND; return 1
  fi
  for service in app postgres minio waf; do
    compose_at "$release" ps --services --status running | grep -qx "$service" || {
      echo "SERVICE_NOT_RUNNING:$service"; return 1;
    }
  done
  echo VERIFY_OK
}

write_state() {
  local sha=$1 release=$2 temporary link_tmp
  mkdir -p -m 0700 "$state_dir"
  temporary=$(mktemp "$state_dir/current.XXXXXXXX")
  printf '%s %s\n' "$sha" "$release" > "$temporary"
  chmod 0600 "$temporary"
  link_tmp="$trial_root/current.$$.link"
  ln -s "$release" "$link_tmp"
  mv -Tf "$link_tmp" "$trial_root/current"
  mv -f "$temporary" "$state_file"
}

require_existing
case "$command_name" in
  adopt)
    sha=$(git -C "$repo" rev-parse HEAD)
    trial_valid_sha "$sha" || { echo REPOSITORY_COMMIT_INVALID; exit 1; }
    if [[ -e $state_file ]]; then
      read_state
      echo "ALREADY_ADOPTED:$current_sha"
      exit 0
    fi
    verify_at "$repo"
    write_state "$sha" "$repo"
    echo "ADOPTED:$sha"
    ;;
  status)
    read_state
    echo "DEPLOYED:$current_sha"
    compose_at "$current_release" ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}'
    ;;
  verify)
    read_state
    verify_at "$current_release"
    echo "DEPLOYED:$current_sha"
    ;;
  update)
    target=$2
    read_state
    mkdir -p -m 0700 "$state_dir"
    exec 9>"$state_dir/update.lock"
    flock -n 9 || { echo UPDATE_ALREADY_RUNNING; exit 1; }
    verify_at "$current_release" >/dev/null || { echo CURRENT_RELEASE_UNHEALTHY; exit 1; }
    if [[ $target == "$current_sha" ]]; then
      echo "UNCHANGED:$target"
      exit 0
    fi
    if ! trial_has_local_commit "$repo" "$target"; then
      if ! timeout 90 git -C "$repo" -c http.version=HTTP/1.1 fetch --no-tags origin "$target" >/dev/null 2>&1; then
        echo FETCH_FAILED_OLD_RELEASE_RETAINED; exit 1
      fi
    fi
    trial_has_local_commit "$repo" "$target" || { echo COMMIT_NOT_FOUND; exit 1; }
    git -C "$repo" merge-base --is-ancestor "$current_sha" "$target" || {
      echo NON_FAST_FORWARD_REJECTED; exit 1;
    }
    classification=$(git -C "$repo" diff --name-only "$current_sha" "$target" | trial_classify_diff)
    [[ $classification != *'blocked=1'* ]] || { echo MIGRATION_OR_INGRESS_CHANGE_REQUIRES_REVIEW; exit 1; }
    release="$trial_root/releases/$target"
    mkdir -p -m 0700 "$trial_root/releases"
    if [[ -e $release ]]; then
      [[ $(git -C "$release" rev-parse HEAD) == "$target" ]] || { echo RELEASE_PATH_CONFLICT; exit 1; }
    else
      git -C "$repo" worktree add --detach "$release" "$target" >/dev/null 2>&1 || {
        echo RELEASE_PREPARATION_FAILED; exit 1;
      }
    fi
    trial_prepare_bind_mounts "$release" || { echo BIND_MOUNT_PREPARATION_FAILED; exit 1; }
    if [[ $classification == *'app=0 waf=0'* ]]; then
      verify_at "$release"
      write_state "$target" "$release"
      echo "METADATA_ONLY:$target"
      exit 0
    fi
    old_app=$(docker image inspect nanjing-petcare:local --format '{{.Id}}')
    old_waf=$(docker image inspect nanjing-petcare-waf:local --format '{{.Id}}')
    short=${target:0:12}
    if [[ $classification == *'app=1'* ]]; then
      docker build --progress=plain -f "$release/Dockerfile" \
        -t "nanjing-petcare:trial-$short" "$release" >"$state_dir/build-app.log" 2>&1 || {
          echo APP_BUILD_FAILED_OLD_RELEASE_RETAINED; exit 1;
        }
    fi
    if [[ $classification == *'waf=1'* ]]; then
      docker build --progress=plain --build-arg GOPROXY=https://mirrors.tencent.com/go/ \
        -f "$release/deploy/local-production/Dockerfile.waf" \
        -t "nanjing-petcare-waf:trial-$short" "$release/deploy" >"$state_dir/build-waf.log" 2>&1 || {
          echo WAF_BUILD_FAILED_OLD_RELEASE_RETAINED; exit 1;
        }
    fi
    [[ $classification != *'app=1'* ]] || docker tag "nanjing-petcare:trial-$short" nanjing-petcare:local
    [[ $classification != *'waf=1'* ]] || docker tag "nanjing-petcare-waf:trial-$short" nanjing-petcare-waf:local
    if compose_at "$release" up -d --no-build --force-recreate app waf >"$state_dir/activate.log" 2>&1 \
       && trial_wait_for_verify 25 2 verify_at "$release"; then
      write_state "$target" "$release"
      echo "UPDATED:$target"
    else
      compose_at "$release" ps --all >"$state_dir/failed-ps.log" 2>&1 || true
      compose_at "$release" logs --no-color --tail=40 waf >"$state_dir/failed-waf.log" 2>&1 || true
      docker tag "$old_app" nanjing-petcare:local
      docker tag "$old_waf" nanjing-petcare-waf:local
      compose_at "$current_release" up -d --no-build --force-recreate app waf >"$state_dir/rollback.log" 2>&1 || true
      trial_wait_for_verify 25 2 verify_at "$current_release" || true
      echo UPDATE_FAILED_ROLLBACK_ATTEMPTED
      exit 1
    fi
    ;;
esac
