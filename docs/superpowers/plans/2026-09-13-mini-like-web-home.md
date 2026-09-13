# 小程序式网页首页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把共用网页首页改为真实可点、白色系、手机小程序式的信息架构。

**Architecture:** 只改 `PublicLanding` 的共用结构与响应式 CSS；演示及真实入口继续注入各自的订单回调和后台服务目录。快捷入口由启用的服务列表生成，不创建模拟人物或搜索结果。

**Tech Stack:** React、TypeScript、CSS、Vitest、Testing Library、Vite。

## Global Constraints

- 保留平台派单及上门喂猫/遛狗业务。
- GitHub Pages 继续标明浏览器演示，不承接真实订单。
- 不新增虚构评价、人员推荐、商城或消息入口。

---

### Task 1: 可用的快捷入口和底部导航

**Files:**
- Modify: `apps/admin/src/demo/PublicLanding.tsx`
- Test: `apps/admin/src/demo/PublicLanding.test.tsx`

**Interfaces:**
- Consumes: `catalog.services[type].enabled`、`onQuoteStartOrder(selection)`、`onViewOrders`、`onStartOrder`。
- Produces: `aria-label="服务快捷入口"` 的导航；`aria-label="快捷导航"` 的四项底部导航。

- [ ] **Step 1: Write the failing test** — 渲染 `PublicLanding`，断言“上门喂猫”快捷按钮把 `{serviceType:'CAT_FEEDING',district:'建邺区'}` 传给 `onQuoteStartOrder`；“我的订单”调用 `onViewOrders`；禁用遛狗后快捷入口消失。断言底部导航依次为首页、服务、预约、订单。
- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @pet/admin exec vitest run src/demo/PublicLanding.test.tsx --maxWorkers=1 --no-file-parallelism`，应因缺少 `服务快捷入口` 失败。
- [ ] **Step 3: Write minimal implementation** — 在页头加入预约胶囊按钮，首页横幅之前加入基于 `availableServices.map` 的服务快捷按钮，以及订单按钮和 `href="#safeguards"`；底栏改为四项，其中预约调用 `onStartOrder`。
- [ ] **Step 4: Run test to verify it passes** — 同 Step 2，预期所有 `PublicLanding` 测试通过。

### Task 2: 手机优先的小程序排版

**Files:**
- Modify: `apps/admin/src/demo/customer-web.css`
- Test: `apps/admin/src/demo/PublicLanding.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.store-search-cta`、`.store-quick-categories`、`.customer-quick-nav` 类名。
- Produces: 760px 以下四列快捷入口、紧凑左右分栏横幅与四列固定底栏；桌面沿用已有白色设计变量。

- [ ] **Step 1: Write the failing test** — 读取 CSS，断言末尾小屏规则包括 `grid-template-columns: repeat(4, minmax(0, 1fr))`、横幅 `grid-template-columns: minmax(0, 1fr) 35%` 和 `prefers-reduced-motion`。
- [ ] **Step 2: Run test to verify it fails** — 同 Task 1 命令，预期因布局规则缺失失败。
- [ ] **Step 3: Write minimal implementation** — 为新头部预约胶囊按钮、快捷入口图标和手机分栏横幅增加样式；页脚保持手机安全区；确保按钮至少 44px 点击区域。
- [ ] **Step 4: Run test to verify it passes** — 同 Task 1 命令，预期通过。

### Task 3: 全量验证与发布

**Files:**
- Verify: `apps/admin/src/demo/PublicLanding.tsx`、`apps/admin/src/demo/customer-web.css`
- Update: `01-Projects/pet-home-service-platform/` 下的本次变更摘要。

- [ ] **Step 1: Run all frontend tests** — `pnpm --filter @pet/admin exec vitest run --maxWorkers=1 --no-file-parallelism`，预期 0 失败。
- [ ] **Step 2: Run typecheck/build** — `pnpm --filter @pet/admin typecheck` 与 `pnpm --filter @pet/admin build`，预期退出码 0。
- [ ] **Step 3: Review change scope** — `git diff --check`，预期无空白错误；检查公开演示提示未移除。
- [ ] **Step 4: Commit and push** — 仅提交本计划相关文件，推送 `origin/main`；公开网页只更新 UI，不声称生产后端上线。
