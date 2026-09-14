import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

function run(script) {
  return spawnSync(bash, ['-c', script], { cwd: repository, encoding: 'utf8', timeout: 10_000 });
}

test('trial updater classifies documentation, app, WAF, and blocked infrastructure changes', () => {
  const result = run(`set -e
    source ./scripts/trialctl-lib.sh
    printf '%s\\n' 'docs/README.md' 'scripts/trialctl.test.mjs' 'deploy/trial/petcare-trial-verify.timer' 'deploy/TRIAL_AUTOMATION.md' | trial_classify_diff
    printf '%s\\n' 'apps/api/src/app.ts' 'deploy/local-production/Dockerfile.waf' | trial_classify_diff
    printf '%s\\n' 'prisma/migrations/001/init.sql' | trial_classify_diff
    printf '%s\\n' 'deploy/local-production/Caddyfile' | trial_classify_diff`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), [
    'app=0 waf=0 blocked=0',
    'app=1 waf=1 blocked=0',
    'app=0 waf=0 blocked=1',
    'app=0 waf=0 blocked=1',
  ].join('\n'));
});

test('trial updater accepts only complete lowercase commit IDs', () => {
  const result = run(`set -e
    source ./scripts/trialctl-lib.sh
    trial_valid_sha 0123456789abcdef0123456789abcdef01234567
    ! trial_valid_sha 01234567
    ! trial_valid_sha 0123456789ABCDEF0123456789abcdef01234567
    ! trial_valid_sha '../../etc/passwd'`);
  assert.equal(result.status, 0, result.stderr);
});

test('trial activation waits for a temporarily unready service and stops on success', () => {
  const result = run(`set -e
    source ./scripts/trialctl-lib.sh
    attempts=0
    probe() {
      attempts=$((attempts + 1))
      [[ $attempts -ge 3 ]]
    }
    trial_wait_for_verify 4 0 probe
    printf '%s\\n' "$attempts"`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '3');
});

test('trial activation reports failure after bounded readiness attempts', () => {
  const result = run(`set -e
    source ./scripts/trialctl-lib.sh
    attempts=0
    probe() { attempts=$((attempts + 1)); echo PROBE_UNREADY >&2; return 1; }
    if trial_wait_for_verify 3 0 probe; then exit 9; fi
    [[ $attempts -eq 3 ]]
    printf '%s\\n' 'retry-exhausted'`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'retry-exhausted');
  assert.equal((result.stderr.match(/PROBE_UNREADY/g) ?? []).length, 1);
});

test('trial updater can recognize a locally imported complete commit without network', () => {
  const result = run(`set -e
    source ./scripts/trialctl-lib.sh
    sha=$(git rev-parse HEAD)
    trial_has_local_commit . "$sha"
    ! trial_has_local_commit . 0000000000000000000000000000000000000000`);
  assert.equal(result.status, 0, result.stderr);
  const controller = readFileSync(path.join(repository, 'scripts/trialctl.sh'), 'utf8');
  assert.match(controller, /if ! trial_has_local_commit "\$repo" "\$target"; then\s+if ! timeout 90 git/s);
});

test('trial updater captures failed edge startup evidence before rollback', () => {
  const controller = readFileSync(path.join(repository, 'scripts/trialctl.sh'), 'utf8');
  const capture = controller.indexOf('failed-waf.log');
  const rollback = controller.indexOf('docker tag "$old_app" nanjing-petcare:local');
  assert.ok(capture > 0 && capture < rollback);
  assert.match(controller, /failed-ps\.log/);
});

test('trial release exposes only public bind-mount files to non-root containers', () => {
  const result = run(`set -e
    source ./scripts/trialctl-lib.sh
    release=$(mktemp -d)
    mkdir -p "$release/deploy/local-production"
    for name in Caddyfile coraza.conf minio-init.sh admin-init.sh; do
      touch "$release/deploy/local-production/$name"
      chmod 600 "$release/deploy/local-production/$name"
    done
    trial_prepare_bind_mounts "$release"
    for name in Caddyfile coraza.conf minio-init.sh admin-init.sh; do
      [[ $(stat -c %a "$release/deploy/local-production/$name") == 644 ]]
      rm -- "$release/deploy/local-production/$name"
    done
    rmdir "$release/deploy/local-production" "$release/deploy" "$release"
    printf '%s\\n' BIND_MOUNTS_READABLE`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'BIND_MOUNTS_READABLE');
  const controller = readFileSync(path.join(repository, 'scripts/trialctl.sh'), 'utf8');
  assert.match(controller, /trial_prepare_bind_mounts "\$release"/);
});

test('trial controller exposes explicit commands and rejects malformed updates before side effects', () => {
  const help = run('bash ./scripts/trialctl.sh --help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /adopt.*status.*verify.*update/);
  const invalid = run('bash ./scripts/trialctl.sh update not-a-commit');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /INVALID_COMMIT/);
});

test('scheduled maintenance verifies only and never fetches or deploys', () => {
  const service = readFileSync(path.join(repository, 'deploy/trial/petcare-trial-verify.service'), 'utf8');
  const timer = readFileSync(path.join(repository, 'deploy/trial/petcare-trial-verify.timer'), 'utf8');
  assert.match(service, /^ExecStart=\/bin\/bash \/opt\/petcare-trial\/current\/scripts\/trialctl\.sh verify$/m);
  assert.doesNotMatch(service + timer, /trialctl\.sh update|git fetch/);
  assert.match(timer, /^OnBootSec=3min$/m);
  assert.match(timer, /^OnUnitActiveSec=15min$/m);
  assert.match(timer, /^Persistent=true$/m);
});

test('trial backup validates a private archive and detects corruption', () => {
  const result = run(`set -e
    source ./scripts/trial-backup-lib.sh
    backup=$(mktemp -d)
    printf '%s' 'database export' > "$backup/orders.dump"
    mkdir -p "$backup/object"
    printf '%s' 'synthetic image' > "$backup/object/image.txt"
    tar -cf "$backup/minio-data.tar" -C "$backup/object" .
    trial_backup_write_checksums "$backup"
    trial_backup_validate_checksums "$backup"
    printf '%s' 'corrupt' >> "$backup/orders.dump"
    if trial_backup_validate_checksums "$backup"; then exit 9; fi
    rm -r -- "$backup"
    printf '%s\\n' CORRUPTION_DETECTED`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'CORRUPTION_DETECTED');
});

test('trial backup retention removes only old complete directories inside its own root', () => {
  const result = run(`set -e
    source ./scripts/trial-backup-lib.sh
    root=$(mktemp -d)
    for stamp in 20260910T000000Z 20260911T000000Z 20260912T000000Z 20260913T000000Z; do
      mkdir "$root/$stamp"
      touch "$root/$stamp/SHA256SUMS"
    done
    mkdir "$root/.partial-test" "$root/notes"
    trial_backup_prune "$root" 3
    [[ ! -e "$root/20260910T000000Z" ]]
    [[ -d "$root/20260911T000000Z" && -d "$root/20260913T000000Z" ]]
    [[ -d "$root/.partial-test" && -d "$root/notes" ]]
    rm -r -- "$root"
    printf '%s\\n' RETENTION_SCOPED`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'RETENTION_SCOPED');
});

test('trial backup is daily and never exposes data or changes the running stack', () => {
  const script = readFileSync(path.join(repository, 'scripts/trial-backup.sh'), 'utf8');
  const service = readFileSync(path.join(repository, 'deploy/trial/petcare-trial-backup.service'), 'utf8');
  const timer = readFileSync(path.join(repository, 'deploy/trial/petcare-trial-backup.timer'), 'utf8');
  assert.match(script, /trialctl\.sh" verify/);
  assert.match(script, /pg_dump/);
  assert.match(script, /pg_restore -l/);
  assert.match(script, /minio_data/);
  assert.match(script, /trial_backup_validate_checksums/);
  assert.doesNotMatch(script, /docker compose[^\n]* (up|down)|git fetch|trialctl\.sh" update/);
  assert.match(service, /^ExecStart=\/bin\/bash \/opt\/petcare-trial\/current\/scripts\/trial-backup\.sh$/m);
  assert.match(timer, /^OnCalendar=\*-\*-\* 03:30:00$/m);
  assert.match(timer, /^Persistent=true$/m);
});

test('restore drill selects only the latest complete private backup', () => {
  const result = run(`set -e
    source ./scripts/trial-backup-lib.sh
    root=$(mktemp -d)
    mkdir "$root/20260910T000000Z" "$root/20260911T000000Z" "$root/20260913T000000Z" "$root/.partial-20260912T000000Z" "$root/notes"
    touch "$root/20260910T000000Z/SHA256SUMS" "$root/20260911T000000Z/SHA256SUMS"
    selected=$(trial_backup_latest "$root")
    [[ $selected == "$root/20260911T000000Z" ]]
    rm -r -- "$root"
    printf '%s\\n' LATEST_COMPLETE_SELECTED`);
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
  assert.equal(result.stdout.trim(), 'LATEST_COMPLETE_SELECTED');
});

test('restore drill accepts only its own temporary database names', () => {
  const result = run(`set -e
    source ./scripts/trial-restore-lib.sh
    trial_restore_valid_db petcare_restore_20260914190000_1234
    ! trial_restore_valid_db petcare
    ! trial_restore_valid_db postgres
    ! trial_restore_valid_db 'petcare_restore_20260914190000_1;drop database petcare'
    printf '%s\\n' RESTORE_NAME_SCOPED`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'RESTORE_NAME_SCOPED');
});

test('weekly restore drill uses isolated database and object volume, never the live database', () => {
  const script = readFileSync(path.join(repository, 'scripts/trial-restore-drill.sh'), 'utf8');
  const service = readFileSync(path.join(repository, 'deploy/trial/petcare-trial-restore.service'), 'utf8');
  const timer = readFileSync(path.join(repository, 'deploy/trial/petcare-trial-restore.timer'), 'utf8');
  assert.match(script, /trial_backup_latest/);
  assert.match(script, /trial_backup_validate_checksums/);
  assert.match(script, /trial_restore_valid_db/);
  assert.match(script, /createdb/);
  assert.match(script, /pg_restore/);
  assert.match(script, /dropdb/);
  assert.match(script, /docker volume create/);
  assert.match(script, /docker volume rm/);
  assert.match(script, /trap on_exit EXIT/);
  assert.doesNotMatch(script, /docker compose[^\n]* (up|down)|git fetch|trialctl\.sh" update/);
  assert.match(service, /^ExecStart=\/bin\/bash \/opt\/petcare-trial\/current\/scripts\/trial-restore-drill\.sh$/m);
  assert.match(timer, /^OnCalendar=Sun \*-\*-\* 04:00:00$/m);
  assert.match(timer, /^Persistent=true$/m);
});
