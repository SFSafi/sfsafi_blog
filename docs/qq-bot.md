# QQ Bot 更新订阅与部署

代码已准备独立 `sfsafi-qq-bot` Cloudflare Worker：`bot/worker.ts` + `wrangler.bot.jsonc`。支持官方 HTTP Webhook，无需常驻 WebSocket 进程；部署在独立 Worker，使用现有 D1 的独立 qq_* 表持久保存订阅和任务，不依赖 Codex 机器。**当前没有真实 QQ 应用凭据，独立 Bot 还未部署，未验收真实 QQ 投递。**

## 平台核实（2026-10-14）

官方现行接口支持 `/v2/groups/{group_openid}/messages` 与 `/v2/users/{user_openid}/messages`，凭证接口为 `https://api.bot.qq.com/app/getAppAccessToken`，开放 API 域名 `https://api.bot.qq.com`，Authorization 使用 QQBot access_token。HTTP 回调使用 Ed25519 签名；URL 验证响应按事件文档生成。

群被动消息有效 5 分钟、每条最多回复 5 次；官方文档列出主动消息频控，群主动消息还可能因无权限、机器人非群成员、禁言等拒绝。代码兼容群和个人，不代表某个账号已经取得主动推送权限；必须在机器人平台完成相应申请、审核与真实授权。不会改用个人账号协议规避限制。

来源：
- https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html
- https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html
- https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
- https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/

## 站主网页配置

1. 在 QQ 机器人开放平台建立应用，申请需要的群/C2C 事件与主动消息能力，获取 AppID 与 ClientSecret。不要把 ClientSecret 发到聊天。
2. Cloudflare Workers & Pages 创建新的 Git Worker 项目，关联同一仓库与 stage-a，名称 `sfsafi-qq-bot`。构建命令 `npm run build:bot`，部署命令 `npx wrangler deploy --config wrangler.bot.jsonc`；保留现有博客项目的配置，不改成 Bot 配置。
3. Bot 使用已提供的现有 D1 UUID；表首次有效事件/任务处理时幂等建立，不需复制 SQL。配置下表变量后部署。

| 位置 | 名称 | 类型/内容 |
| --- | --- | --- |
| Bot Worker | QQ_APP_ID | Text，官方应用 AppID |
| Bot Worker | QQ_APP_SECRET | Secret，官方 ClientSecret |
| Bot Worker 与博客 Worker | QQ_SITE_SECRET | Secret，同一个独立随机密钥，至少 32 字符；由密码管理器生成，不与 ClientSecret 混用 |
| Bot Worker 与博客 Worker | SITE_URL | Text，https://sfsafi-blog.jonce-z.workers.dev （无子路径） |
| Bot Worker | QQ_GROUP_IDS | Text，允许订阅的 group_openid，多个逗号分隔 |
| Bot Worker | QQ_GROUP_OPERATOR_IDS | Text，允许操作群订阅的 member_openid，多个逗号分隔 |
| 博客 Worker | QQ_BOT_WEBHOOK_URL | Text，**实际部署成功的** Bot 地址加 `/site-updates` |

4. 将实际 Bot 地址的 `/qq/events` 配置为 QQ 官方事件回调，完成 URL 验证（回调须公开可达，由 Ed25519 验证，不套用站主管理页的 Access 登录），订阅 GROUP_AT_MESSAGE_CREATE、C2C_MESSAGE_CREATE 及对应退订/移除事件。
5. 在指定群 @Bot。经过签名验证的群/操作人 OpenID 会出现在站主 `/admin/notifications/` 的“群授权候选”，只对站主可见。选择有权操作的群和成员填写白名单；空白名单时不接受群订阅，不能把任意成员操作当作整群授权。
6. 私聊发送“订阅”，群授权操作人 @Bot 发送“订阅”；也支持“订阅 #标签”“查看订阅”“退订/取消订阅”。身份来源于签名有效的官方事件，不接受网站上任意填写 QQ 号码作为目标。

环境没有 Cloudflare 账号登录或 QQ 应用凭据，以上账号内操作不能代执行。不要启用不必要的付费套餐；实际账号权限/额度须在控制台核实。

## 发布与投递

首次发布与 publication_outbox 写入同一 D1 事务。博客每 5 分钟处理队列；只有对应公开页面的版本已可访问才发送 HMAC 签名的 `POST /site-updates`。Bot 验证签名、5 分钟时间窗口、站点来源和事件字段，按 eventId 幂等持久接收，再返回 accepted；**accepted 不是 QQ 已送达**。

Bot 每分钟处理任务，Webhook 也会唤起处理。订阅扇出分批、投递限量：每次处理最多 2 个 QQ 投递，全局每分钟 10 次主动/回复调用的内部额度；群默认每日 100 次、个人默认每日 30 次主动调用。实际允许数量还受 QQ 平台限制，内部限量不能代替平台授权。初始实现面向小站，不能承诺大量订阅即时送达。

只向事件发生前已有效订阅且标签匹配的目标创建任务。发送前再次检查订阅/标签/群授权、文章可访问和版本；退订、移除授权、撤回文章阻止待发任务。失败指数退避，网站最多 8 次、Bot 最多 5 次；任务和结果在 D1 保存，重启不重复生成已存在任务。

QQ群/个人发送 API 的真实回执有 message ID 时才记 sent。网络超时、服务器异常或成功响应缺失有效回执等结果不确定情况记 uncertain，不自动盲目重发。站主在通知页核对后可以手动重试 failed/uncertain；uncertain 必须明确确认可能重复。无法承诺网络异常下绝对恰好一次送达。

## 验收与运维

`npm run build:bot` 已 dry-run 打包；本地真实 Workerd/D1 + 模拟官方响应验证了 Ed25519/HMAC、白名单、群和个人订阅/投递、退订、撤回、持久化重启与去重。没有把模拟平台回执称为真实 QQ 成功。

部署后检查 `/health`（只暴露配置是否存在，不暴露 Secret/OpenID），再做真实 URL 验证、群与个人订阅、站内首次发布、消息送达、退订和失败处理。Cloudflare 托管服务负责运行实例，不用云开发机守进程；Cron 配置须确认生效。监控 Cloudflare 错误日志和 `/admin/notifications/` 的真实状态，备份 D1 的 qq_* 与 publication_outbox 表，恢复演练仍未进行。
