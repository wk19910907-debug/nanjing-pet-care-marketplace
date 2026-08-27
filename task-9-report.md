# Task 9 真实试运营验收报告

日期：2026-08-28
基线：`616de65`
运行时：Node.js 22.23.2、pnpm 10.15.0、PostgreSQL 16（一次性 Docker 容器）、Chrome/Playwright

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
- Playwright live：1/1；首次完整 GREEN 10.3 秒，最终独立复验 10.0 秒。
- 服务器重启次数：1；重启后三个原浏览器会话和 owner 订单继续有效。
- 清理：API 进程、`petcare-live-*` PostgreSQL 容器、临时证据和 Playwright 输出均已删除。

## 完整验证

- `pnpm lint`：通过，0 warnings。
- `pnpm typecheck`：5 个工作区通过。
- `pnpm test`：在另一个已执行 5 个迁移的全新 PostgreSQL 16 上通过，共 358/358（Admin 142、Contracts 7、Mini Program 11、Domain 18、API 180）。
- `pnpm build` 与 `pnpm pilot:build`：通过；pilot 产物 44 modules，JavaScript 248.13 kB（gzip 75.54 kB）。
- `pnpm --filter @pet/admin test:e2e`：16/16。
- `pnpm --filter @pet/admin test:e2e:pilot`：4/4。
- `pnpm test:e2e:live`：最终独立复验 1/1。
- 提交前残留检查：没有 `petcare-live-*` / `petcare-suite-*` 容器，没有 `petcare-live-*` 临时目录。

## 关注项

- 该验收面向单机开发试点，Cookie 在 `NODE_ENV=development` 下不设置 Secure；生产配置仍要求 HTTPS、Secure Cookie、精确 Origin 和 S3 兼容对象存储。
- 本地证据使用短时签名 capability；测试只校验授权和字节读取，不把 URL 或 token 写入报告。
- `postgres:16-alpine` 使用 PostgreSQL 16 当前补丁版本；runner 通过 SQL 校验主版本，不固定补丁版本。
