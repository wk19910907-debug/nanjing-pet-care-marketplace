# 真实网站部署手册

这套部署运行网站和同源 API，面向小范围受控试点。首期仍是人工收款；没有真实支付回调、通知、法律/保险审查或 ICP备案时，不得宣传为全面正式运营。

## 1. 外部资源

准备以下由你本人控制的资源：

- 一台安装 Docker Engine 与 Compose plugin 的 Linux 主机，公网防火墙只放行 TCP 80/443 和 UDP 443；SSH 仅允许你的管理来源。
- 一个域名。把站点子域的 DNS A/AAAA 记录指向主机；80/443 必须可从公网访问，Caddy 才能自动申请和续期 TLS 证书。
- 独立 PostgreSQL 数据库和最小权限账号。生产连接使用服务商要求的 TLS 参数，例如 `sslmode=require`，启用每日备份和时间点恢复。
- 私有 S3兼容桶。凭据只允许该桶所需的读写/HEAD，并允许应用执行桶级 `HeadBucket` 就绪检查；CORS 只允许生产网站源、`Content-Type` 与 `x-amz-checksum-sha256`，不得公开桶。

应用、数据库和对象存储不要使用个人日常管理员凭据。不得把密钥、密码、数据库 URL、Cookie 或证书提交到 Git、写入本文档或 Obsidian Vault。

## 2. 生成服务器密钥

在目标服务器运行两次 `openssl rand -base64 32`，分别作为 `FIELD_ENCRYPTION_KEY_V1` 和 `PILOT_AUTH_PEPPER`。两者必须不同，并存入服务器的秘密管理或权限为600的环境文件。不要在聊天、截图或命令历史中传递现有生产密钥。

如果只能在 PowerShell 生成，可在本机交互式终端运行以下片段，每次重新生成一份；随后直接放入目标服务器秘密管理：

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

## 3. 配置

在服务器的仓库目录：

```sh
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

编辑这个未跟踪文件：

- `SITE_DOMAIN` 是不带协议的域名；`PILOT_PUBLIC_ORIGIN` 必须是对应的完整 `https://` 源。
- `APP_VERSION` 写本次已验证的 Git commit，便于镜像回滚。
- 填入 PostgreSQL、两份 Base64 密钥和 S3配置。
- `FIELD_ENCRYPTION_KEY_V1` 只用于首次部署；轮换时使用 `FIELD_ENCRYPTION_KEYRING` 和 `FIELD_ENCRYPTION_ACTIVE_VERSION`，保留旧版本直到重加密与恢复演练完成。
- `PILOT_SHARED_INGRESS_RATE_LIMITING=enabled` 声明入口 WAF/反向代理已配置跨实例限流；应用内登录限流只是一台实例的内存边界。
- `PILOT_TRUST_PROXY=172.30.0.2` 与 Compose 中固定的 Caddy 内网地址对应，不要改成任意公网网段。
- 后端容器没有宿主机端口，但其 Docker 网络必须保留出站能力，才能连接外部 PostgreSQL 和 S3；不要把 `backend` 改成 `internal: true`。
- `WECHAT_LOGIN_ENABLED=false` 保持关闭，直到真实 AppID/AppSecret、合法域名和真机验收完成。

先验证 Compose 展开；输出会包含环境变量，必须只在受控终端查看，不要粘贴到工单或聊天：

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml config --quiet
```

## 4. 首次部署

部署前确认数据库已经备份。生产迁移使用 Prisma `migrate deploy`，不会执行 `migrate dev` 或自动重置数据库。启动命令会先迁移，失败时应用不会启动。首次启动前，必须在受控 TTY 中交互执行 `pnpm staff:create-admin -- --username <管理员用户名>`；临时密码不得放入环境变量、命令行、文件、日志或截图，且必须在管理员第一次网页登录时改掉。没有管理员账户时不得把 `/health/ready` 视为可对外接单。

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml ps
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs --tail=100 app caddy
```

验证 `https://你的域名/health/ready` 返回200且 `ready/database/objectStorage/encryption` 均为true。确认浏览器证书有效、Cookie 为 `Secure`、HTTP 自动跳转 HTTPS，并且站点和 `/api` 保持同一 `https://` Origin。日志不得出现数据库 URL、S3凭据、会话或用户地址。

参考：[Docker Compose健康检查与启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)、[Prisma生产迁移](https://docs.prisma.io/docs/cli/migrate/deploy)、[Caddy自动HTTPS](https://caddyserver.com/docs/automatic-https)。

## 5. 受控验收

不要导入本机已有用户数据。新建专用测试账号，在网页完成：

1. 宠主登录并提交一笔不收费的测试订单。
2. 平台后台查看订单并匹配一个测试服务人员。
3. 服务人员查看任务、开始服务并上传无隐私的测试图片/报告。
4. 宠主查看记录并确认完成。
5. 管理员检查订单状态、S3对象和审计记录一致。

删除测试数据必须使用产品允许的可恢复方式或保留为明确标记的验收记录，不能直接执行数据库删除命令。

## 6. 备份与恢复演练

- PostgreSQL：启用服务商每日加密备份和时间点恢复。每月至少恢复到隔离数据库一次，核对用户、订单、审计数量后销毁隔离副本。
- S3：启用版本控制、服务端加密、生命周期与访问日志；验证误删对象可以恢复。
- Caddy数据卷保存证书状态，但可由域名和配置重建，不替代业务备份。
- 记录最近可恢复时间、演练日期和负责人，不记录密钥。

没有完成一次恢复演练，不向真实用户开放。

## 7. 更新与回滚

更新前保留上一版本的 `APP_VERSION` 和镜像，执行相同 `up -d --build`。部署后重新检查 `/health/ready` 和一笔隔离测试订单。

如新版本异常，把 `deploy/.env.production` 的 `APP_VERSION` 改回已保留的上一镜像标签，再执行：

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --no-build
```

回滚只回滚应用镜像；数据库迁移使用向前修复，不执行破坏性自动回滚。数据库不可写、解密失败或S3不可用时应停止新下单并保留现场。

## 8. 上线边界

此部署包不替你购买主机/域名，不代办实名认证、ICP备案、协议签署或支付商户配置。只有 HTTPS、真实订单闭环、备份恢复和权限验收全部通过后，才能称为“可进行受控真实试点”。人工收款必须由运营线下核对并留存合规凭证，系统当前不会自动确认资金到账。

GitHub Pages 只承载浏览器本地体验，绝不能作为真实订单、Cookie 会话或同源 API 的生产 Origin。生产网页不公开手机号、二维码、邀请码或邀请入口。
