#!/usr/bin/env bash

trial_valid_sha() {
  [[ ${1:-} =~ ^[0-9a-f]{40}$ ]]
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
