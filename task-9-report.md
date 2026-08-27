# Task 9 真实试运营验收报告

日期：2026-08-28
基线：`616de65`
运行时：Node.js 22.22.2、pnpm 10.15.0、PostgreSQL 16（一次性 Docker 容器）、Chrome/Playwright

## 交付

- 新增 `pnpm test:e2e:live`，自动创建空 PostgreSQL 16、执行 5 个迁移、构建 pilot UI、bootstrap 管理员、启动真实 API、运行三上下文 Playwright，并在成功或失败后清理全部专用资源。
- 新增 ADMIN/OWNER/PROVIDER 三角色真实闭环；没有应用路由 mock。
- 新增 API 中途重启验收，证明 HttpOnly 会话和共享订单数据保存在 PostgreSQL。
- 新增地址候选/分配/完成后的精确权限边界，以及 owner/provider/admin/anonymous 的证据访问边界。
- 新增 390×844 移动端 44px 控件、无横向溢出、空浏览器存储和禁止联系方式/支付入口检查。
- 新增 operator quickstart 与 live acceptance 文档。

## TDD 记录

1. RED：先添加 `pnpm test:e2e:live`，命令因 runner 不存在而以 `MODULE_NOT_FOUND` 失败。
2. RED：真实浏览器流程发现 bodyless POST 被 Fastify 5 拒绝，响应为 HTTP 500 `{ "code": "SERVICE_UNAVAILABLE" }`。
3. 根因：pilot 客户端给无 body 的 POST 强加 `Content-Type: application/json`，Fastify 在进入人工费用路由前报空 JSON body。
4. RED：focused Vitest 证明人工费用与派单请求携带了错误 Content-Type。
5. GREEN：仅在请求实际有 body 时添加 JSON Content-Type；focused transport 测试 10/10 通过。
6. GREEN：完整 live E2E 通过，包含真实人工费用、派单、接受、签到、证据、报告和宠主确认。

## 实时验收结果

- 空数据库迁移：5/5。
- Playwright live：1/1；首次完整 GREEN 10.3 秒，final-review expanded 独立复验 13.0 秒，final-rereview expanded 最终复验 14.4 秒。
- 服务器重启次数：1；重启后三个原浏览器会话和 owner 订单继续有效。
- 清理：API 进程、`petcare-live-*` PostgreSQL 容器、临时证据和 Playwright 输出均已删除。

## 完整验证

- `pnpm lint`：通过，0 warnings。
- `pnpm typecheck`：5 个工作区通过。
- `pnpm test`：在另一个已执行 5 个迁移的全新 PostgreSQL 16 上通过，共 359/359（Admin 142、Contracts 7、Mini Program 11、Domain 18、API 181）。
- `pnpm build` 与 `pnpm pilot:build`：通过；pilot 产物 44 modules，JavaScript 248.12 kB（gzip 75.53 kB）。
- `pnpm --filter @pet/admin test:e2e`：16/16。
- `pnpm --filter @pet/admin test:e2e:pilot`：4/4。
- `pnpm test:live-cleanup`：stale-run、子进程等待与独占锁模拟 6/6。
- `pnpm test:e2e:live`：final-rereview expanded 最终复验 1/1（14.4 秒）。
- 提交前残留检查：没有 `petcare-live-*` / `petcare-suite-*` 容器，没有 `petcare-live-*` 临时目录。

## 关注项

- 该验收面向单机开发试点，Cookie 在 `NODE_ENV=development` 下不设置 Secure；生产配置仍要求 HTTPS、Secure Cookie、精确 Origin 和 S3 兼容对象存储。
- 本地证据使用短时签名 capability；测试只校验授权和字节读取，不把 URL 或 token 写入报告。
- `postgres:16-alpine` 使用 PostgreSQL 16 当前补丁版本；runner 通过 SQL 校验主版本，不固定补丁版本。

## Final review 补强（2026-08-28）

- live 场景仍只创建三个 browser contexts；完成第一闭环后，OWNER/PROVIDER context 注销并以第二账号顺序复用，覆盖同角色订单、地址、报告、证据、接受邀请和外键写入隔离，以及旧 Cookie 服务端撤销后的 401。
- console/pageerror 监听提前至首次导航前；登录至最终状态逐阶段检查 390×844、44px 控件、横向溢出和正文/控件属性敏感字段，并复用三个 context 切换至 1280×800 做桌面检查。
- 证据读取改为逐字节比对上传 PNG。观察业务请求集不含支付路径，并对已知 payment/webhook/WeChat payment 路径逐一断言 404。
- runner 增加 distinct port reservations、SIGINT/SIGTERM 幂等清理、SIGKILL 后的无敏感字段 marker、Docker label、API PID/命令行身份校验和下次运行精确回收。确定性 stale-run smoke 4/4 通过；一次真实失败残留也已由下一次 live 开始时成功回收。
- README 不再建议 clean shell 裸跑依赖数据库的 `pnpm check`；quickstart 在迁移前轮询 `pg_isready` 和 SQL 主版本。

## Final rereview 补强（2026-08-28）

- 新增服务人员同角色写隔离的精确回归：第一服务人员保留一个状态仍为 `PENDING` 的邀请，第二服务人员对该邀请接受写入只能得到 403/404，而非先被状态冲突 409 掩盖；随后第二服务人员只接受自己的邀请。focused API 测试已在全新迁移 PG16 上由 RED（`DISPATCH_CONFLICT`）转为 GREEN。
- live runner 的 `run`、`capture`、API、Prisma、Vite、Playwright 和 Docker CLI 子进程统一进入 owned-child registry；SIGINT/SIGTERM 清理终止并等待全部精确子进程。即使 `docker run` 尚未返回，清理仍检查并只移除本次名称及 run label 一致的容器。
- 固定 stale marker 改为独占创建锁，并发 runner 不覆盖现有 marker；管理员邀请码不再进入 Playwright 环境变量，而由 loopback control server 一次性读取。确定性 cleanup/lock 测试为 6/6。
- ADMIN、OWNER、PROVIDER 的关键中间态与最终态均复用原三个 context 切到 1280×800，执行与 390×844 相同的 44px、横向溢出、storage、HttpOnly Cookie 不可见及正文/控件属性敏感字段断言，再恢复手机视口。
- console error 豁免不再依赖宽泛状态文本，只接受已登记的精确 page、URL、状态且必须观察到对应失败 response；pageerror 仍要求为空。
- rereview expanded live 在 Node.js 22.22.2、全新 PG16、真实 API/构建 UI、恰好三个 context 下最终通过 1/1（14.4 秒），结束后 runner 报告并验证资源清理成功。
