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
4. 构建 pilot UI，生成一次性管理员邀请码，并启动真实 Fastify pilot server。
5. 启动一个 Playwright worker，创建恰好三个隔离浏览器上下文：`ADMIN`、`OWNER` 和 `PROVIDER`。
6. 无论成功或失败，都停止 API、删除专用数据库容器、删除证据目录和 Playwright 临时产物。

运行器不会打印数据库密码、加密密钥、认证 pepper、会话值或一次性邀请码。不要使用 `DEBUG=*`、网络录制或永久 trace 重跑含真实试点数据的验收。

## 覆盖的闭环

- 管理员 bootstrap、邀请码兑换、展示昵称和一次性宠主/服务人员邀请。
- 三个真实 HttpOnly、SameSite=Lax Cookie 会话，页面 JavaScript 无法读取会话值。
- 服务人员申请、可服务时间和管理员批准。
- 宠主宠物、加密详细地址、服务器报价和订单；客户端不提交总价。
- 管理员记录线下费用核对并启动真实派单；无支付路由或支付凭据。
- 候选阶段只有南京市/区/服务圈；接受邀请前完整地址接口返回 403。
- 被分配服务人员在时间窗内显式读取地址、确认到场状态、签到、上传真实图片字节、完成喂猫清单并提交报告。
- 宠主读取报告和授权证据后确认完成；任务完成后完整地址权限关闭。
- 管理员、宠主和服务人员的越权 API 请求返回 403；匿名证据读取请求返回 401。
- 中途真实停止并重新启动 API 进程；原三个 Cookie 会话和 PostgreSQL 订单数据继续有效。
- 390×844 视口下可见按钮、输入框、选择框和文本区高度至少 44px，且无横向溢出。
- localStorage/sessionStorage 为空；页面无手机号、微信号、二维码、银行卡或证件材料；无意外浏览器控制台错误。

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
