# 试运营真实浏览器验收

## 运行命令

在 Node.js 22.x、pnpm 10.x、Docker 和 Chrome 可用的环境中执行：

```powershell
pnpm test:e2e:live
```

该命令拒绝 Node.js 22 以外的版本。它会自动完成以下工作：

1. 生成不落盘的临时数据库凭据、认证 pepper 和字段加密密钥。
2. 启动全新的 `postgres:16-alpine` 容器并通过 SQL 校验主版本为 16。
3. 从空数据库执行全部 Prisma 迁移。
4. 构建 pilot UI，生成一次性管理员邀请码，并通过只监听 loopback 的一次性读取端点交给测试；邀请码不进入子进程环境变量。随后启动真实 Fastify pilot server。
5. 启动一个 Playwright worker，创建恰好三个隔离浏览器上下文：`ADMIN`、`OWNER` 和 `PROVIDER`；第二个宠主和服务人员账号顺序复用后两个上下文，不创建第四个上下文。
6. 无论成功或失败，都终止并等待 runner 启动的每个精确子进程，再删除带本次 run label 的数据库容器、证据目录和 Playwright 临时产物；Docker 启动尚未返回的竞态也会按精确 label 检查。`SIGKILL` 无法被进程捕获，下一次运行会依据已验证的 marker 精确回收。

运行器不会打印数据库密码、加密密钥、认证 pepper、会话值或一次性邀请码。不要使用 `DEBUG=*`、网络录制或永久 trace 重跑含真实试点数据的验收。

## 覆盖的闭环

- 管理员 bootstrap、邀请码兑换、展示昵称和一次性宠主/服务人员邀请。
- 三个真实 HttpOnly、SameSite=Lax Cookie 会话，页面 JavaScript 无法读取会话值。
- 服务人员申请、可服务时间和管理员批准。
- 宠主宠物、加密详细地址、服务器报价和订单；客户端不提交总价。
- 管理员记录线下费用核对并启动真实派单；观察到的业务流程不请求支付路径，已知支付 webhook、创建和微信支付路径在 pilot server 上明确返回 404。
- 候选阶段只有南京市/区/服务圈；接受邀请前完整地址接口返回 403。
- 被分配服务人员在时间窗内显式读取地址、确认到场状态、签到、上传真实图片字节、完成喂猫清单并提交报告。
- 宠主读取报告和授权证据后确认完成；下载图片字节与上传 PNG 完全一致；任务完成后完整地址权限关闭。
- 原宠主和服务人员注销后，同一上下文的后续请求及携带已撤销旧 Cookie 的请求均返回 401。第二宠主不能读取、确认、报告或用第一宠主的宠物/地址 ID 下单；第一服务人员另有一个仍为 `PENDING` 的邀请，第二服务人员对该精确邀请执行接受写入得到 403/404，随后只能接受自己的 `PENDING` 邀请，也不能读取第一服务人员订单、地址或证据。
- 管理员、宠主和服务人员的越权 API 请求返回 403；匿名证据读取请求返回 401。
- 中途真实停止并重新启动 API 进程；原三个 Cookie 会话和 PostgreSQL 订单数据继续有效。
- 从登录、昵称、邀请、申请、宠主表单/订单、审核/费用/派单、履约到最终状态的每个主要阶段，390×844 视口下可见交互控件高度至少 44px 且无横向溢出；三个现有上下文还会在各角色关键中间态和最终工作区切换到 1280×800，执行相同的控件、溢出、存储、Cookie 与敏感字段断言，然后恢复 390×844。
- localStorage/sessionStorage 为空；正文及控件 label、placeholder、name 不出现被禁止的联系方式、敏感入户字段或认证 token 字段；监听器在首次导航前安装。预期负向请求只按精确 browser context、URL 和实际响应状态临时登记，不按宽泛状态文本忽略控制台错误；除此之外 console/pageerror 为空。

所有业务请求都进入实际应用；测试文件不调用 `page.route`，也不替换 Fastify 路由、Prisma 或对象存储适配器。

## 失败处理

- Node 版本错误：切换到 Node.js 22.x 后重跑。
- Docker 不可用：先运行 `docker version`，恢复 daemon 后重跑。
- Chrome 不可用：安装 Chrome，或按团队评审后的统一浏览器策略调整配置。
- 端口冲突：运行器使用临时 loopback 端口；若仍失败，检查安全软件或遗留进程。
- 测试失败：保留控制台输出，但不要复制邀请码、Cookie 或临时数据库 URL。运行器会在失败路径同样清理资源。

清理复核：

```powershell
docker ps --all --filter "name=petcare-live-" --format "{{.Names}}"
Get-ChildItem $env:TEMP -Directory -Filter 'petcare-live-*'
```

两条命令都应无输出。

stale marker 的路径固定为系统临时目录下的 `petcare-live-state-v1.json`，以独占创建方式充当单实例锁；并发 runner 会安全失败且不会覆盖先运行者。marker 只包含版本、run ID、runner/API PID、带命名空间的容器名和精确临时目录，不包含数据库密码、邀请码、Cookie、pepper、字段密钥或 capability。清理、子进程等待和独占锁的确定性模拟可运行 `pnpm test:live-cleanup`。
