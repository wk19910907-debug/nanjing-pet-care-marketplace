#!/usr/bin/env bash

trial_valid_sha() {
  [[ ${1:-} =~ ^[0-9a-f]{40}$ ]]
}

trial_has_local_commit() {
  local repository=$1 sha=$2
  trial_valid_sha "$sha" && git -C "$repository" cat-file -e "$sha^{commit}" 2>/dev/null
}

# Compose can report an app healthy before the reverse proxy accepts TLS.
# Poll the actual end-to-end verification condition, with a strict bound.
trial_wait_for_verify() {
  local max_attempts=$1 delay_seconds=$2 attempt
  shift 2
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    if ((attempt < max_attempts)); then
      sleep "$delay_seconds"
    fi
  done
  return 1
}

# Classify a git diff without interpreting paths as shell commands.
# Unknown application files are rebuilt conservatively; infrastructure and
# migrations require an explicit migration/security review outside this tool.
trial_classify_diff() {
  local path app=0 waf=0 blocked=0
  while IFS= read -r path; do
    case "$path" in
      ''|docs/*|scripts/*|deploy/trial/*|.github/*|README*|AGENTS.md) ;;
      deploy/local-production/Dockerfile.waf) waf=1 ;;
      deploy/compose.local-production.yml|deploy/local-production/*|prisma/migrations/*) blocked=1 ;;
      *) app=1 ;;
    esac
  done
  printf 'app=%s waf=%s blocked=%s\n' "$app" "$waf" "$blocked"
}
