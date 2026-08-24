# GitHub Pages 公开体验部署设计

## 目标

把“南京安心宠”现有 React/Vite 网页体验版发布到公开 GitHub Pages 地址，让访客无需安装依赖即可体验“宠主下单 → 平台匹配 → 服务人员履约 → 宠主确认”闭环，同时保留现有 Windows 本地一键启动方式。

## 产品边界

- 公开页面是演示产品，不承接真实订单。
- 订单与体验状态只保存在访问者当前浏览器的本地存储中，不上传服务器。
- 页面不得要求或鼓励访客填写真实手机号、精确住址、门锁密码、支付信息或其他敏感信息。
- 不接入真实支付、短信、地图、对象存储、生产数据库或微信账号体系。
- 本地入口继续使用 `http://127.0.0.1:43123`，公开部署不得改变该行为。

## 方案选择

采用 GitHub Pages 与 GitHub Actions。仓库本身已经公开，网页是无服务端依赖的 Vite 单页应用，因此该方案无需新增账户、服务器或付费资源，并能在 `main` 更新后自动重新部署。

暂不采用 Cloudflare Pages，因为它需要额外账户连接；暂不采用独立服务器，因为当前体验版没有真实后端需求，而且生产服务器会提前引入备案、安全和运维成本。

## 架构

1. `main` 分支发生推送时，GitHub Actions 在 Node.js 22 与 pnpm 10 环境中安装锁定依赖。
2. 工作流执行管理端类型检查、单元测试和生产构建。
3. Vite 根据部署环境使用 `/nanjing-pet-care-marketplace/` 作为静态资源基础路径；本地开发继续使用 `/`。
4. 工作流把 `apps/admin/dist` 上传为 GitHub Pages artifact，并由官方 Pages 部署动作发布。
5. 浏览器加载静态页面后，现有 React 体验流程继续通过 `localStorage` 保存状态，不向远端发送订单内容。

## 文件职责

- `apps/admin/vite.config.ts`：根据 GitHub Actions/Pages 构建环境选择正确的 Vite `base`。
- `.github/workflows/pages.yml`：安装、验证、构建并发布静态产物。
- `README.md`：提供公开体验地址、本地启动入口和演示数据安全边界。
- `apps/admin/e2e/service-loop.spec.ts`：继续验证核心服务闭环；部署配置不改变业务交互。

## 部署与权限

- 工作流只申请 GitHub Pages 官方部署所需的最小权限：读取仓库内容、写入 Pages、签发部署身份令牌。
- 使用 GitHub 官方维护的 checkout、configure-pages、upload-pages-artifact 和 deploy-pages actions。
- 构建不读取仓库密钥，不保存用户数据，不包含 API 密钥。
- GitHub 仓库 Pages 来源设为 GitHub Actions。

## 错误处理

- 依赖安装、类型检查、测试或构建任一步失败时，工作流立即失败，不发布新版本。
- 静态资源路径错误由生产构建后的本地静态预览与浏览器检查发现。
- 已发布页面不可用时，GitHub Actions 部署记录提供失败步骤；上一成功版本不依赖本地开发服务。
- 页面继续显示“体验数据只保存在当前浏览器”和敏感信息警告。

## 验证标准

- `pnpm --filter @pet/admin typecheck` 通过。
- `pnpm --filter @pet/admin test` 通过。
- `pnpm build` 通过，生成 `apps/admin/dist/index.html` 和带仓库子路径的静态资源引用。
- 本地 `pnpm dev` 仍可在 `http://127.0.0.1:43123` 使用。
- GitHub Actions Pages 部署成功。
- 公开地址 `https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/` 返回成功页面，并显示“南京安心宠”、三种体验身份和提交订单入口。
- 线上完整体验流程可完成，刷新后数据仍保留在同一浏览器。

## 非目标

- 本次不接入真实订单、数据库、支付、短信、地图或微信登录。
- 本次不购买或绑定自定义域名。
- 本次不删除已合并功能分支。
- 本次不把微信小程序发布到微信公众平台。
