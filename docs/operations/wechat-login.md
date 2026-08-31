# 微信登录接入与验收

## 已实现的范围

原生客户端已有 `wx.login` → POST `/api/v1/auth/wechat/session` 调用。服务端现在使用固定 HTTPS 微信接口交换 code，再建立/读取账号并签发现有 PilotSession 会话。新账号只会成为 OWNER，既有 PROVIDER 身份保留，后台工作人员不能通过此入口获取会话。不需要宠主邀请码，也不接受客户端指定 role/openid。

接口仅接受 JSON `{code: string}`，成功返回 `{token, expiresAt}`，不设置 Cookie，禁止缓存。后续 GET `/api/v1/pilot/session` 读取账号，POST `/api/v1/pilot/me` 完成昵称。未完成昵称不能进入业务接口。会话持久化、到期及撤销沿用既有逻辑。

微信身份的 AppID/openid 经域分离 HMAC 后存入既有唯一 `User.wechatOpenId` 字段（`wx1:` 前缀）；无表结构迁移。临时 code、AppSecret、微信 session_key、unionid 不存入业务数据库或日志，交换不自动重试；无效/已用 code 必须由客户端重新发起微信登录。

## 服务端配置

- 默认不启用。启用需在服务器进程安全配置 `WECHAT_LOGIN_ENABLED` 为 `true`，以及真实 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`。现有 `PILOT_MODE` 必须为 `enabled`，会话 pepper 必须有效。启用但配置缺失/格式错误时拒绝启动。
- 凭据仅放服务器密钥管理或 Vault 之外的受保护运行时配置，不能放小程序、网页、GitHub Pages、仓库、日志或知识库。这里只记录变量名称。
- 当前身份摘要复用 `PILOT_AUTH_PEPPER`。跨实例与重启必须保持一致并安全备份；不要直接轮换它，否则现有身份映射与会话失效。更换需专门的迁移方案。不要把原始 openid 手工填入此字段或修改用户角色作为正常入驻流程。
- 生产部署仍要求原有数据库、加密、S3 和 public origin 等配置。`/health/ready` 当前只检测已有基础依赖，不主动向微信发请求，不能用它证明微信登录正常。
- 对外必须使用 HTTPS API 域名，和小程序后台的合法 request 域名一致；客户端 AppID 必须与服务端配置相同。小程序 trial/release 使用此登录；develop 保持仅本地回环的开发账号入口。
- 服务端必须能向 `api.weixin.qq.com` 出站 HTTPS。请禁用包含完整 URL/响应体的代理调试与 APM 抓取，尤其不可记录 `secret`、`js_code` 和 `session_key`。

## 安全边界

接口拒绝 Cookie、Authorization 或不匹配的浏览器 Origin；只有精确登录路径允许原生无 Origin 请求。其他写接口仍执行原有权限与跨站保护。请求体上限 2 KiB、每 IP 每分钟最多 10 次尝试（包括失败）、每进程最多 32 个在途交换及 10,000 个限流键。微信响应最多 16 KiB，交换超时 5 秒，禁止重定向。

多实例部署应在入口网关增加共享限流/反滥用措施；应用内限流不是分布式限流。仅把实际受控反向代理 IP/CIDR 配进 `PILOT_TRUST_PROXY`，不得信任任意 X-Forwarded-For。

错误：无效或已用 code 返回 401 `WECHAT_CODE_INVALID`；输入格式错误 400；限流 429；未启用、微信异常或后台故障返回 503 `WECHAT_LOGIN_UNAVAILABLE`。错误不回显上游详情，也不创建假会话。

## 真机验收（尚未完成）

1. 安全配置真实 AppID/AppSecret，部署 API；小程序配置相同 AppID 与 HTTPS API/合法域名。不要把 code 或 token 复制到工单/截图。
2. trial 体验版首次进入预约，微信登录后填写一个昵称；后台应只有一个对应 OWNER，不应新增任何邀请码。
3. 退出/重开体验版、让会话过期后再登录，确认仍关联同一账号与资料；服务端重启也不能换号。
4. 断网/交换失败不能显示成功；恢复后用户重试获取新 code。已用 code 不得兑换第二个会话。不能通过点击服务人员入口提升身份。
5. 使用原生宠物/地址新增完成首单预约；服务人员入驻衔接后，执行真实订单与服务证据闭环。网站本地演示账号和微信账号尚未自动绑定。首次预约与资料接口升级见[小程序运维说明](miniprogram.md)。

自动化使用受控微信 HTTP 响应与临时 PostgreSQL，验证接口组合、角色、并发、会话持久化和错误边界；没有调用真实用户的微信账号。GitHub Pages 依旧是静态体验版，不是此 API 的部署位置。
