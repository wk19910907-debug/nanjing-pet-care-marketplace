# 本地试运营快速启动

本说明用于单机、受控的南京试点环境。它不会启用公开注册、手机号登录、微信扫码、在线支付或联系方式展示，也不替代生产部署和合规评审。

## 前置条件

- Node.js 22.x；执行 `node --version` 必须显示 `v22`。
- pnpm 10.x；执行 `pnpm --version` 必须显示 `10`。
- Docker 可用，用于 PostgreSQL 16。
- Chrome 可用，用于浏览器验收。

## 首次启动

以下 PowerShell 命令在当前终端生成一次性数据库密码和加密材料，不把真实值写入仓库、Vault 或命令文件。

```powershell
$pilotRunId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$pilotContainer = "petcare-pilot-$pilotRunId"
$pilotDbPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$pilotEvidence = Join-Path $env:TEMP "petcare-pilot-evidence-$pilotRunId"

docker run --detach --rm --name $pilotContainer --publish 127.0.0.1:54329:5432 `
  --env POSTGRES_USER=pilot `
  --env "POSTGRES_PASSWORD=$pilotDbPassword" `
  --env POSTGRES_DB=pilot `
  postgres:16-alpine

$pilotDatabaseReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  docker exec $pilotContainer pg_isready --username pilot --dbname pilot *> $null
  if ($LASTEXITCODE -eq 0) {
    $pilotVersion = docker exec $pilotContainer psql --username pilot --dbname pilot --tuples-only --no-align --command 'SHOW server_version_num'
    if ($LASTEXITCODE -eq 0 -and $pilotVersion.Trim().StartsWith('16')) {
      $pilotDatabaseReady = $true
      break
    }
  }
  Start-Sleep -Milliseconds 500
}
if (-not $pilotDatabaseReady) { throw 'PostgreSQL 16 did not become SQL-ready' }

$env:NODE_ENV = 'development'
$env:DATABASE_URL = "postgresql://pilot:$([Uri]::EscapeDataString($pilotDbPassword))@127.0.0.1:54329/pilot?schema=public"
$env:FIELD_ENCRYPTION_KEY_V1 = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:PILOT_AUTH_PEPPER = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:PILOT_MODE = 'enabled'
$env:PILOT_HOST = '127.0.0.1'
$env:PILOT_PORT = '3000'
$env:PILOT_EVIDENCE_DIR = $pilotEvidence

pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm pilot:start
```

服务启动后访问 <http://127.0.0.1:3000>，在页面上选择“宠主”、“服务人员”或“平台管理员”身份进入。如需同时验收三个角色，请在三个隔离的本地浏览器上下文中分别选择角色。该直接入口只用于 `development` 和 `test`，服务端只接受 loopback 请求地址；生产环境不注册此 API 路由。

首次进入后设置非实名展示昵称，然后依次完成服务人员申请与审核、宠主下单、线下费用核对、派单和履约。页面不提供邀请码登录或邀请管理，不会处理在线支付，也不应录入手机号、微信号、银行卡、门锁密码或证件材料。不要把任何 Cookie、令牌、生成密钥或兼容 API 产生的邀请码粘贴到 Markdown、聊天记录、截图、日志或 `.env`。

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/live
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

健康响应只表示进程和数据库就绪，不包含邀请码、Cookie、地址、密钥或证据内容。

## 安全停止与清理

先在运行服务的终端按 `Ctrl+C`，再在保存上述变量的同一 PowerShell 终端执行：

```powershell
if ($pilotContainer -notmatch '^petcare-pilot-[a-f0-9]{12}$') { throw 'Unexpected container name' }
docker rm --force $pilotContainer

$resolvedEvidence = [IO.Path]::GetFullPath($pilotEvidence)
$resolvedTemp = [IO.Path]::GetFullPath($env:TEMP)
if (-not $resolvedEvidence.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected evidence path' }
if ([IO.Path]::GetFileName($resolvedEvidence) -notmatch '^petcare-pilot-evidence-[a-f0-9]{12}$') { throw 'Unexpected evidence path' }
Remove-Item -LiteralPath $resolvedEvidence -Recurse -Force -ErrorAction SilentlyContinue
```

关闭终端会丢弃本次进程环境变量。若需要保留试点数据，不要删除数据库容器；应改用单独评审过的持久化部署方案和备份策略。

自动验收 runner 会响应 `SIGINT` / `SIGTERM` 并幂等清理。`SIGKILL` 或主机断电无法被进程捕获；runner 只在系统临时目录记录不含凭据的资源 marker，并给数据库容器和 API 进程写入本次运行身份。下一次 `pnpm test:e2e:live` 会先验证容器 label、API 命令行、PID 和精确临时路径，再回收上一轮资源；任一身份不匹配都会停止而不会扩大删除范围。

## 生产边界

本地角色直接入口不是生产身份方案：它仅在 `development` 和 `test` 注册、仅允许 loopback 请求，生产环境中该路由必须不存在。正式对外运营还必须实现经安全评审的生产认证，并配置精确 Origin、Secure Cookie、字段加密和 S3 兼容对象存储。不要把本页的单机文件证据目录或临时数据库命令当作生产部署方案。生产环境不需要微信支付或微信通知凭据，但仍必须通过完整配置校验和安全评审。
