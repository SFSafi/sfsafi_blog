# Cloudflare Workers 部署与新增功能启用

现有网站：https://sfsafi-blog.uk ，备用地址 https://sfsafi-blog.jonce-z.workers.dev 。已实际检查首页、详情、文章、分页、样式和媒体可访问，未知地址和草稿为 404。站主确认 GitHub 自动部署跟踪 stage-a。

新增功能已通过 PR #1 合入 stage-a，Cloudflare production 构建成功。线上 D1 阅览去重、赞踩切换和取消、公开资料/地点接口及未登录管理拒绝已通过真实请求验证。管理员仍需账号内 Access 登录配置。

## 1. D1 已提供，自动初始化

站主已提供数据库 UUID，已写入 wrangler.jsonc 的 DB 绑定：8713524f-f776-4dbc-8a9f-1b03414c6cf6。

无需复制 SQL 到网页：Worker 首次动态页面或 API 请求会自动建立初始表与触发器，并用 space_schema 记录版本。初始化只接受八个纯新增迁移中的 CREATE TABLE/TRIGGER IF NOT EXISTS；每个版本在事务中提交，不删除/替换现有数据，可安全重复。构建时 npm prepare 从迁移文件生成忽略的 Worker schema 模块，不把测试数据库提交到 Git。

Workers Git 自动构建使用 npm run build，部署命令使用 npx wrangler deploy；部署读取 wrangler.jsonc，DB 指向该 D1，ASSETS 指向 dist。如果当前部署命令带 --assets ./dist，可以保留；它仍需部署 main 字段的 worker/index.ts，而不能切换成仅静态资源模式。

keep_vars=true 保留控制台配置的非密钥变量，避免后续 Git 部署抹掉 Access 配置。Secrets 不提交到仓库。

当前 D1 绑定与自动初始化已在线验证。将来如果 Cloudflare 构建拒绝绑定数据库，检查项目自动部署身份对该数据库的权限；不要把 API Token 发到聊天。docs/cloudflare-schema.sql 仅作为初始结构参考/诊断，正常首次部署不需要站主手动执行。

未来非初始迁移应单独评审执行，不能把破坏性 SQL 加入启动初始化。站主不需要本地安装或运行命令。

## 2. Cloudflare Access 管理员登录

统一管理页 `/admin/`，覆盖文案、写文、资料、地点、评论、转码与通知；私有 API 统一在 `/api/admin/*`。站主操作说明见 [admin.md](admin.md)。

在 Cloudflare Zero Trust 中创建自托管 Access 应用，仅覆盖该 Workers 域名的 `/admin/*` 和 `/api/admin/*`，保持公开首页与公开统计接口不受管理员登录限制。启用邮箱验证码登录，Allow 策略只填写站主邮箱，不能使用 Everyone 或 Bypass。若应用界面支持多路径，在同一应用配置两个路径，确保它们使用同一 AUD。

从 Access 应用读取 Audience（AUD），以及团队域名（例如 your-team.cloudflareaccess.com），在 Worker 中设置非密钥变量 ACCESS_AUD 和 ACCESS_TEAM_DOMAIN。团队域名不含 scheme、端口或路径。应用 Audience 并非登录密钥，可以提供给开发任务；不要把邮箱验证码或 JWT 发到聊天。

worker 验证 Cf-Access-Jwt-Assertion 的 RS256 签名、issuer、audience、有效期和身份声明；不能靠隐藏管理按钮保障安全。未授权写入会被拒绝，未配置时不接受写入。workers.dev 的 Access 支持需按实际账户入口配置；若域名/路径级入口在当前账号不可用，需另行选择支持该保护方式的自有域名或认证方案，不宣称已配置成功。

## 3. 线上复验

数据库与登录配置就绪后，检查首页统计、详情浏览去重、赞踩切换与刷新、二维码和链接、管理员手机上传头像/改昵称/修改地点、未授权操作拒绝。重新部署后再次检查资料与计数仍存在。公开页面只读取已发布内容，不开放发文权限。

## 当前限制

没有 Cloudflare API 凭据，开发任务无法修改账号 Access 策略；数据库已由站主建立，初始表将由已绑定 Worker 的运行权限自动初始化。以上可在网页完成，不需站主本地安装。本地 Workerd/D1、受控 Access 签名令牌测试以及线上 D1 公开接口已验证；未验证账号中的真实邮件登录。D1 使用和 Worker 请求受免费额度约束，超过额度时需重新评估费用；没有启用任何付费套餐。

自定义域名与文字管理已接通；图文/视频上传和真实 QQ 投递尚未接通。代码回滚与内容恢复分别见 operations.md。

官方资料（2026-10-14 查看）：

- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

## 4. 公开站内 AI 搜索

页面 /search/ 与接口 /api/search 已实现；站主配置 Secret AI_API_KEY、Text AI_BASE_URL/AI_MODEL 即可启用，详见 [ai-search.md](ai-search.md)。未配置时提供真实关键词搜索，不调用模型。默认全站每日 100 次、每网络地址每分钟 6 次，AI_DAILY_LIMIT 可调整或设置 0 暂停。

## 5. 写文、评论与 Bot

写文/评论管理的 OWNER_EMAIL 已配置为用户指定邮箱；需真实 ACCESS_TEAM_DOMAIN/AUD 与账号 Allow 策略。具体操作见 [writing.md](writing.md)。独立 Bot Git 项目与凭据步骤见 [qq-bot.md](qq-bot.md)，不要覆盖现有博客的 Worker 配置。现有自动部署仍跟踪 stage-a；博客与 Bot 的配置文件分别为 wrangler.jsonc 与 wrangler.bot.jsonc。

## 6. 独立 FFmpeg 服务

新增 `/admin/media/` 和站主 `/api/admin/media/*` 代理。启用时需要独立 Linux/Docker 服务器、持久卷、HTTPS 服务地址，博客配置 Text `TRANSCODER_URL`、Secret `TRANSCODER_TOKEN`。站主确认暂时没有服务器，先完成代码与说明；不要设置虚假服务地址或把 Codex 临时进程当作生产服务。详见 [ffmpeg.md](ffmpeg.md)。R2 和正文媒体发布尚未接通。

## 7. 评论直接显示与回复邮件

评论提交后直接显示，站主可在 `/admin/comments/` 删除。可选邮箱与回复通知通过 Resend 接入；Secrets/发件域名/队列与限额配置见 [comment-email.md](comment-email.md)。未配置服务时不发送邮件，不影响评论发布。

## 8. 统一后台与网站文案

`/admin/site/` 的设置存入 D1 新增 site_settings 表，0008 迁移自动建立；保留现有数据，无需创建额外服务。`npm run build` 自动收集默认文案，生成 src/lib/copy-catalog.json，Worker 在输出 HTML 时应用设置，浏览器同步替换动态提示。保存文案或已发布文章不需要 Git 部署；静态构建单独部署不会拥有持久管理能力。所有设置写入仍需 Access + OWNER_EMAIL 与同源校验。详见 [admin.md](admin.md)。
