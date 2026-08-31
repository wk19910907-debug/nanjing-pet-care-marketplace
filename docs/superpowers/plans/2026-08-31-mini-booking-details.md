# 原生首次预约 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded API task; the main agent handles the native page and integration. Steps use checkboxes.

**Goal:** 新微信宠主可以直接添加宠物、地址，选择上门时间并提交匹配订单。

**Architecture:** 复用鉴权资料接口，增加可选请求幂等键和owner-only门牌展示。原生预约页提供小型内联表单、明确保存/选择状态与报价快照。

**Tech Stack:** Node22、TypeScript、Prisma/PostgreSQL、原生WXML/WXSS、Vitest。

## Global Constraints

- 无宠主邀请码，不添加手机号、门锁密码或经纬度输入。
- 不删除用户资料，地址加密存储；门禁指令不得进入列表。
- clientRequestId 可选、1–100位ASCII字母数字/下划线/横线，按owner隔离。
- 同键不同内容409 PROFILE_REQUEST_CONFLICT；旧客户端不带键仍可使用。
- 开放服务与区域来自后台，日期/时间按北京时间 +08:00。
- 未知写入结果沿用快照和键，卸载后不更新UI；不把原生自动化称为真机验收。

### Task 1: 后端资料幂等与可辨认的本人地址

**Files:** prisma/schema.prisma、新增migration；apps/api/src/pets/{routes,pet-service,address-service}.ts；apps/api/src/app.ts；apps/api/tests 下新增专用临时数据库测试。不得修改小程序或网站。

**Interfaces:** 原POST请求增加 `clientRequestId?: string`，返回现有安全视图；GET地址列表每项增加 `detail: string`，只返回当前OWNER所属记录。不返回访问说明和加密字段。重复保存同样返回201，冲突409。

- [ ] 先写真实临时数据库测试：同键两次/并发一个记录、payload冲突、owner隔离、staff拒绝、无键兼容、列表解密本人门牌但无门禁信息，路由校验键和409映射。
- [ ] 运行定向测试确认现有实现重复创建/未返回detail；使用临时库而非修改现有订单。
- [ ] 新增nullable clientRequestId 与组合唯一索引。按唯一约束读取原记录并比较规范化内容（可解密内部字段比较，不存不加密的敏感内容指纹）；冲突不可覆盖原数据。
- [ ] `pnpm --filter @pet/api test <新增测试文件>`、API lint/typecheck；提交仅所负责文件并写报告。

### Task 2: 原生预约资料与时间输入

**Files:** apps/miniprogram/services/api.ts；新增services/booking-details.ts和services/booking-details-page.ts；pages/owner/order-create/index.{ts,wxml,wxss}；tests/booking-details*.test.ts。

**Interfaces:** API `createPet(input)`、`createAddress(input)` 返回可选择安全记录。纯函数构造带key的资料输入、验证响应和北京时间。Page内联新增模式及savePet/saveAddress事件，日期/时间picker；状态持久化仅后台与页面内存。

- [ ] 写失败测试：首次空列表可添加；成功自动选择；失败重试同key/payload；保存中防重复、卸载无副作用；服务变更清报价；旧报价不可提交；未知订单结果不能修改输入后另开订单。
- [ ] 实现API调用与响应校验，纯数据函数、页面保存处理。使用现有区域坐标，不新增地图SDK。
- [ ] 改WXML为名字、地址、日期时间picker，已有资料选择与新增切换；busy/pending写入锁定输入；quote快照一致后提交。
- [ ] 原生测试、全部8入口build、模板检查，已有账号门槛/卸载测试适配真实完整fixture。

### Task 3: 集成验收与交付

- [ ] 独立按规格与质量复核后端及完整变更；处理阻断问题。
- [ ] 完整pnpm check（用已有受保护运行时DB凭据，仅进程环境）、原生build及网站build。
- [ ] 快进同步已验证代码，安全停止已确认的本项目服务，再应用加法migration并以Node22重启。不得改动既有业务记录。
- [ ] 更新运维说明及Vault项目记录；确认代码同步、静态站发布状态，明确真机和生产部署缺口。
