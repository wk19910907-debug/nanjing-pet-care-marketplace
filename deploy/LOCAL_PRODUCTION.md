# 南京安心宠：本地生产环境演练

这是**只在本机开放**的真实共享订单环境，不是 GitHub Pages 演示页，也不是已经上线的公网生产系统。宠主、平台管理员和服务人员使用同一个 PostgreSQL 数据库；履约图片存入私有 MinIO 桶；Coraza/OWASP CRS WAF 是唯一对浏览器开放的 TLS 边界。当前没有在线支付、微信正式登录或自动派单承诺，费用仍由平台线下核对。

## 准备与日常操作

需要 Windows、Node.js 22、pnpm 10、已启动的 Docker Desktop，以及可用的本地 80/443 映射（默认主机映射为 127.0.0.1:8080 和 127.0.0.1:443）。首次运行可能拉取固定版本的容器镜像并构建应用与 WAF 镜像；请预留磁盘空间。若本机 443 或维护端口 54329 已被占用，先解决冲突，不要把服务改绑到公网地址。

在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm local-production:start
pnpm local-production:status
pnpm local-production:verify
```

浏览器入口：<https://petcare.localhost>。图片签名 URL 使用 <https://storage.petcare.localhost>；它不是公开文件目录。WAF 使用 Caddy 的本地内部 CA 证书，首次访问可能出现不受信任提示。只有本机验收浏览器上下文允许忽略此证书错误；不要把该证书当作公网生产证书，也不要在正式浏览器里全局关闭 TLS 校验。`verify` 会真实创建测试订单和服务人员、上传图片，并进行一次不删卷的服务重启；测试订单与图片会保留在本地，脚本只会停用自身以 `verify.` 加固定十六进制编号创建的测试服务人员账号，不会停用普通运营账号。

结束时执行：

```powershell
pnpm local-production:stop
```

`stop`、普通 Docker Desktop 重启以及 `verify` 内部的重启均**保留** PostgreSQL、MinIO 和 Caddy 命名卷。再次 `start` 会在已有数据上运行迁移和就绪检查，不会重置订单。不要运行 `docker compose down -v`、`docker volume rm` 或手动删除卷来解决普通启动问题。

## 管理员凭据与数据安全

首次启动会生成随机生产级密钥和管理员初始密码，保存在当前 Windows 用户的 `%LOCALAPPDATA%\NanjingPetCare\local-production-secrets\`，不在仓库、Obsidian Vault 或浏览器里。仅当前用户和 SYSTEM 有权读取；脚本会检查路径、权限及已有文件，不会静默覆盖。管理员本人需要查看时，在**本机**执行：

```powershell
notepad.exe (Join-Path $env:LOCALAPPDATA 'NanjingPetCare\local-production-secrets\admin-password')
```

不要把 `admin-password`、`local-production.env`、Cookie、签名 URL 或用户地址复制到聊天、工单、终端日志、截图或 Git。管理员首次登录若提示修改临时密码，按页面完成；文件中的引导密码请按本机密码管理流程保管。不要编辑已有密钥文件来“重试”启动：字段加密密钥和数据库/对象存储凭据一旦丢失，旧数据可能无法恢复。

## 备份与恢复

以下是**人工维护流程**，不会由启动或验收命令自动执行。先选择 BitLocker/EFS 保护的本机备份目录；必须另行把上述整个受保护密钥目录备份到加密、异机位置，并保持严格访问控制。数据库导出和图片归档本身也含客户隐私，不能放进 Git、Vault 或公开网盘。示例使用已固定的 PostgreSQL Alpine 镜像作为归档工具，按本仓库默认项目名操作。

一致性备份：先阻止新请求和应用写入，再导出数据库，停止其余服务，最后归档 MinIO 卷。执行前确认没有未完成的服务操作。

```powershell
$backupDir = Join-Path $env:LOCALAPPDATA ('NanjingPetCare\backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
docker stop nanjing-petcare-local-production-waf-1 nanjing-petcare-local-production-app-1
docker exec nanjing-petcare-local-production-postgres-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/petcare-backup.dump'
docker cp nanjing-petcare-local-production-postgres-1:/tmp/petcare-backup.dump (Join-Path $backupDir 'orders.dump')
docker exec nanjing-petcare-local-production-postgres-1 rm -f /tmp/petcare-backup.dump
pnpm local-production:stop
docker run --rm -v nanjing-petcare-local-production_minio_data:/data:ro -v "${backupDir}:/backup" --entrypoint sh postgres:16.10-alpine3.22 -c 'tar -cpf /backup/minio-data.tar -C /data .'
```

检查两个备份文件存在、非空并测试归档可读；随后执行 `pnpm local-production:start` 恢复服务。还要保存备份时间、对应密钥版本和操作记录，但不要记录任何密钥值。建议定期执行异机备份并做隔离恢复演练；本机同盘备份不防设备损坏。

恢复是**覆盖数据**操作，只能在确认选定备份、拥有同一套密钥、已另行保留当前卷快照、无人下单的维护窗口进行。优先在隔离测试实例演练。下面命令仅展示数据库和对象的恢复方法，不能自动判断两份备份是否同一时点；不要直接对正在服务的环境执行。`$backupDir` 必须指向已验证的私有备份目录。

```powershell
pnpm local-production:stop
docker run --rm -v nanjing-petcare-local-production_minio_data:/data -v "${backupDir}:/backup:ro" --entrypoint sh postgres:16.10-alpine3.22 -c 'tar -xpf /backup/minio-data.tar -C /data'
docker start nanjing-petcare-local-production-postgres-1
docker cp (Join-Path $backupDir 'orders.dump') nanjing-petcare-local-production-postgres-1:/tmp/petcare-restore.dump
docker exec nanjing-petcare-local-production-postgres-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/petcare-restore.dump'
docker exec nanjing-petcare-local-production-postgres-1 rm -f /tmp/petcare-restore.dump
pnpm local-production:start
pnpm local-production:verify
```

注意：将对象归档解压到**已有非空卷**不会删除归档之外的旧文件。严格的点位恢复需要在隔离环境准备新空卷并核对数据；不要把“解压成功”误认为完全回滚。任何破坏性重置都应先核对容器、卷名、备份和恢复测试结果，本项目不提供自动删卷脚本。

## 故障检查与上线边界

`status` 查看服务、就绪和本地端口；`verify` 检查 SQL 注入/遍历/XSS 拦截、单实例入口限流的 429、正常 API、匿名对象访问拒绝、签名上传/读取、真实浏览器下单闭环和重启持久性。本机限流状态只在当前 WAF 实例内，重启会清空；它不是公网多副本共享限流。若失败，先确认 Docker Desktop 正在运行、Node.js 版本为 22、443/54329 未被占用、密钥目录未移动，以及四个长期服务是否健康。不要把原始容器日志发到公开渠道：日志和诊断可能包含运营数据。WAF 配置和应用版本变化后应再次执行 `pnpm local-production:verify`。

走向真正公网生产仍需要真实域名与 DNS、公开可信的证书和相应备案/合规工作、托管或独立运维的 WAF、加密异机备份及恢复演练、共享限流、监控告警、生产账号与商户/微信凭据，并完成隐私、服务人员审核和人工履约运营流程。当前本地证书、回环绑定、单机 Docker 卷和单机限流**不能**代替这些条件。公开 GitHub Pages 页面仍是纯浏览器演示，不会自动连接这套本地生产数据。
