#!/bin/sh
set -eu

host_password=/run/secrets/admin-password-host
staging_directory=/run/admin-password
staged_password="$staging_directory/admin-password"
node_home="$staging_directory/home"
node_cache="$staging_directory/cache"

test "$(id -u)" -eq 0
test -f "$host_password"

umask 077
mkdir -p "$node_home" "$node_cache"
cat "$host_password" > "$staged_password"
chmod 0400 "$staged_password"
chown node:node "$staged_password" "$node_home" "$node_cache" "$staging_directory"

exec env -i \
  HOME="$node_home" \
  COREPACK_HOME=/opt/corepack \
  XDG_CACHE_HOME="$node_cache" \
  PNPM_HOME=/pnpm \
  PATH=/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  LOCAL_PRODUCTION_REHEARSAL="$LOCAL_PRODUCTION_REHEARSAL" \
  DATABASE_URL="$DATABASE_URL" \
  PILOT_AUTH_PEPPER="$PILOT_AUTH_PEPPER" \
  su -p node -s /bin/sh -c '
  set -eu
  test "$(id -u)" -eq 1000
  test "$(id -g)" -eq 1000
  test -f /run/admin-password/admin-password
  test "$(stat -c "%a:%u:%g" /run/admin-password/admin-password)" = "400:1000:1000"
  exec pnpm --filter @pet/api bootstrap:local-production-admin -- --password-file /run/admin-password/admin-password
'
