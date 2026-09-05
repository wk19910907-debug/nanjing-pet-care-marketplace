# 本地试运营快速启动

本说明用于单机、受控的南京试点环境。它不会启用公开注册、手机号登录、微信扫码、在线支付或联系方式展示，也不替代生产部署和合规评审。

## 日常一键启动（Windows）

正常使用时直接双击仓库根目录的 `start-local.cmd`。第一次启动会检查 Node.js 22、pnpm 10 和 Docker Desktop，创建仅绑定本机的 PostgreSQL 16 数据库，执行迁移和构建，然后自动打开实际网站。以后再次双击会复用同一数据库、后台运营配置和证据目录；使用期间请保持命令窗口开启，按 `Ctrl+C` 停止网站。

启动器从 `51800` 开始自动选择可监听的网站端口，因此不会再次使用被 Windows 动态保留的 51694。数据库密码、字段加密密钥和认证 pepper 使用 Windows 当前用户 DPAPI 加密，保存在 `%LOCALAPPDATA%\NanjingPetCare`，不会写入仓库或 Obsidian Vault。启动器不会自动删除或替换已有数据库容器、Docker volume、证据目录或保护状态；发现状态不一致时会停止并显示错误。

下面的“首次启动”仍保留给需要完全隔离、运行后主动清理的工程验收场景。

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

服务启动后访问 <http://127.0.0.1:3000>。宠主从“立即预约”创建匿名订单会话并下载恢复凭据；员工从“员工登录”使用由管理员线下交付的账户登录。首次管理员必须在服务可用前通过受控 TTY 交互执行 `pnpm staff:create-admin -- --username <管理员用户名>`，临时密码不写入命令行、环境变量、文件或日志。使用隔离浏览器上下文验收宠主、员工和管理员。

首次进入后设置非实名展示昵称，然后依次完成服务人员申请与审核、宠主下单、线下费用核对、派单和履约。宠主首页只展示“上门喂猫”“上门遛狗”、当前订单和平台保障；选择服务后再按“时间 → 宠物 → 上门信息 → 报价确认”逐步填写，每次只处理一个决定。宠物和地址可以在首次预约中直接添加，备注默认收起且为选填。页面不提供公开凭据或管理入口，不会处理在线支付，也不应录入手机号、微信号、银行卡、门锁密码或证件材料。不要把任何 Cookie、令牌、生成密钥或恢复凭据粘贴到 Markdown、聊天记录、截图、日志或 `.env`。

## 运营配置

平台管理员进入“运营配置”后可以统一维护上门喂猫/遛狗开关、起步价、南京开放区域和短公告。官网、小程序及宠主预约只展示当前开放项，报价仍由服务器生成。保存采用版本检查，若其他管理员已先修改，页面会提示重新读取，避免静默覆盖。

配置变更只作用于新报价和新订单，历史订单总价不回写。回滚时查看运营记录并把上一版值重新保存；不要直接编辑订单状态或历史订单金额。配置更新会写入审计事件，数据库迁移 `202608290001_operations_catalog` 必须在启动前完成。

## 微信小程序接入边界

小程序开发版可通过扩展配置的 `developmentApiBaseUrl` 访问本机 HTTP API；该地址只允许 localhost/127.0.0.1，并使用服务端现有的本机 OWNER Cookie 会话。体验版和正式版只接受公开 HTTPS `apiBaseUrl`，使用 Bearer 会话而不绕过网站 Cookie 的 Origin 防护。发布前还需在微信公众平台配置真实 AppID、合法 request 域名，并在服务端安全配置 AppSecret 以实现 `/api/v1/auth/wechat/session`；客户端只发送 `wx.login` 临时 code，仓库和 Vault 中不得保存 AppSecret。

没有上述微信外部配置时，网站和本地运营闭环可以正常验收，小程序只能做开发者工具界面、配置读取和接口契约验收，不能作为已上线的微信登录渠道。

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

本地单机入口不是生产部署方案。正式对外运营必须使用同源 HTTPS、Secure Cookie、私有 S3、版本化字段加密密钥环、交互式管理员引导和共享入口限流；应用内内存限流只覆盖一个实例。不要把本页的单机文件证据目录或临时数据库命令当作生产部署方案。生产环境不需要微信支付或微信通知凭据，但仍必须通过完整配置校验和安全评审。
