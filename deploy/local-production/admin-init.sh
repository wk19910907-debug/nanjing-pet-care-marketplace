#!/bin/sh
set -eu

host_password=/run/secrets/admin-password-host
staging_directory=/run/admin-password
staged_password="$staging_directory/admin-password"

test "$(id -u)" -eq 0
test -f "$host_password"

umask 077
cat "$host_password" > "$staged_password"
chmod 0400 "$staged_password"
chown node:node "$staged_password" "$staging_directory"

exec su -p node -s /bin/sh -c '
  test "$(id -u)" -eq 1000
  test "$(id -g)" -eq 1000
  test "$(stat -c "%a:%u:%g" /run/admin-password/admin-password)" = "400:1000:1000"
  exec pnpm --filter @pet/api bootstrap:local-production-admin -- --password-file /run/admin-password/admin-password
'
