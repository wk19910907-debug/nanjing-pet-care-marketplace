# 腾讯云试用机：增量运维控制器

本控制器仅针对 `/opt/petcare-trial` 的**私有、虚构数据联调环境**。它不开放公网订单入口，也不把 GitHub Pages 演示改成真实下单。现有密钥位于 `/opt/petcare-trial/secrets`，控制器只读取、不生成或覆盖它们；PostgreSQL、MinIO 和 Caddy 的命名卷不因更新命令删除。

## 固定操作

在试用服务器本机以管理员身份运行：

```bash
bash /opt/petcare-trial/repo/scripts/trialctl.sh adopt
bash /opt/petcare-trial/current/scripts/trialctl.sh status
bash /opt/petcare-trial/current/scripts/trialctl.sh verify
```

`adopt` 仅在首次运行且现有服务健康时写入受限状态文件；重复运行不会重建密钥或容器。`verify` 是只读验收：用本机 CA 正常验证 HTTPS，检查数据库、对象存储、加密、正常 API、WAF 拦截、匿名列桶拒绝以及容器不绑定公网。它**不生成新订单**，因此可以定时运行。

只有在已决定发布某个完整的 40 位 Git 提交后才运行：

```bash
bash /opt/petcare-trial/current/scripts/trialctl.sh update 0123456789abcdef0123456789abcdef01234567
```

上面的提交只是格式示例，不能直接作为部署目标。目标和当前版本相同时，控制器输出 `UNCHANGED`，不拉取或重建镜像。目标有变化时，它从公开 GitHub 仓库抓取这个**固定提交**，只在应用或 WAF 文件改变时构建对应镜像；仅文档、测试和运维脚本变化时只切换版本目录，不重建应用。`/opt/petcare-trial/current` 指向已验收版本，定时服务从那里执行控制器，因此控制器本身也随固定提交前进。若发现 Prisma 迁移或入口/Compose 配置变化，直接拒绝自动更新。抓取、构建失败时旧服务保持运行；切换后健康验收失败则尝试恢复旧镜像和旧 Compose 来源。发布日志位于服务器受限的 `/opt/petcare-trial/state/`，普通输出不含密钥。更新不会删除旧发布目录或命名卷。

若试用机连不上 GitHub，可在可信任的本机仓库先生成仅含基线之后对象的 Git bundle（例如 `git bundle create petcare-update.bundle main ^<当前提交>`），经腾讯云命令通道分块传到试用机仓库外的受限目录，再在试用机运行 `git -C /opt/petcare-trial/repo bundle verify <bundle文件>` 与 `git -C /opt/petcare-trial/repo fetch <bundle文件> main`。完整目标提交已经在本机仓库后，`update <完整提交>` 不再依赖外网抓取；仍会校验完整提交、快进关系和变更范围。bundle 只允许来自本项目可信任仓库，不应把任意下载文件作为发布源。

本次固定发布包 `deploy/trial/bundles/petcare-220a46b-from-a0470bf.bundle` 仅包含基线 `a0470bfd811c1aa407efa978b3f791595237e441` 到目标 `220a46b77a45b9c49e6a55905614dd5607c1ffc6` 的新增 Git 对象，SHA-256 为 `D160D60261AF08C4CCAFCD526F8B089A795B7D289D219178A544BE1688288E1A`。它不含凭据或试用机数据，仅用于这两个固定提交间的离线补丁；其他基线应重新生成并验证 bundle。

## 自动健康检查

将仓库内 `deploy/trial/petcare-trial-verify.service` 和 `.timer` 安装到 `/etc/systemd/system/`，然后启用 timer。它开机 3 分钟后首次检查，之后每 15 分钟检查一次；**不自动拉取代码、不自动发布、不自动创建订单**。失败可通过 `systemctl status petcare-trial-verify.service` 与 `journalctl -u petcare-trial-verify.service` 查看。不要将环境文件、管理员密码或原始应用日志复制到聊天或公开渠道。

## 仍未覆盖的正式运营条件

试用机只有 1 个月期限、2 GB 内存和单机卷；本控制器没有异机加密备份、恢复演练、有效公网域名和证书、备案、托管 WAF/跨实例限流、支付或真实人员履约验收。正式接单前必须单独解决，不得把此私有自动化误称为生产上线。
