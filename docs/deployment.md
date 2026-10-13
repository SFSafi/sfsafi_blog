# Cloudflare Workers 部署与新增功能启用

现有网站：https://sfsafi-blog.jonce-z.workers.dev 。已实际检查首页、详情、文章、分页、样式和媒体可访问，未知地址和草稿为 404。站主确认 GitHub 自动部署跟踪 stage-a。

新增功能在 feature/engagement 分支；尚未更新自动部署分支，当前线上仍是上一版界面。缺 D1 ID 和账号内 Access 登录配置，不宣称新功能已在线。

## 1. D1（仅网页操作）

1. Cloudflare 控制台 → 存储与数据库 → D1，创建 sfsafi-engagement。
2. 将数据库 ID（非密钥 UUID）提供给开发任务，用于替换 wrangler.jsonc 的 REPLACE_WITH_YOUR_D1_DATABASE_ID。不得把占位符配置用于线上部署。
3. 在 D1 控制台打开 Console，粘贴 docs/cloudflare-schema.sql 中的 SQL 并执行，初始化三个迁移的表与触发器。此脚本为幂等 CREATE IF NOT EXISTS，不删除内容。未来升级按 migrations/ 的新文件单独应用。
4. Workers Git 自动构建命令使用 npm run build，部署命令使用 npx wrangler deploy；部署配置读取仓库的 wrangler.jsonc，DB 绑定指向上面创建的 D1，ASSETS 绑定指向 dist。
5. 完成设置后由开发任务将通过检查的功能提交到 stage-a，Git 集成触发部署。不要修改当前线上配置或合并功能分支后再填数据库，以免构建失败。

如 Cloudflare 构建环境已具备 D1 migration 权限，可改成先运行 `npx wrangler d1 migrations apply sfsafi-engagement --remote`，再 `npx wrangler deploy`；未验证其权限前不默认使用这个自动迁移路径。站主不需要在本地运行命令或传 API Token。

## 2. Cloudflare Access 管理员登录

管理页 /admin/profile/（头像、昵称、简介、个人位置）与 /admin/locations/（每条公开内容的手动地点）；写 API /api/admin/profile、/api/admin/locations。

在 Cloudflare Zero Trust 中创建自托管 Access 应用，仅覆盖该 Workers 域名的 `/admin/*` 和 `/api/admin/*`，保持公开首页与公开统计接口不受管理员登录限制。启用邮箱验证码登录，Allow 策略只填写站主邮箱，不能使用 Everyone 或 Bypass。若应用界面支持多路径，在同一应用配置两个路径，确保它们使用同一 AUD。

从 Access 应用读取 Audience（AUD），以及团队域名（例如 your-team.cloudflareaccess.com），在 Worker 中设置非密钥变量 ACCESS_AUD 和 ACCESS_TEAM_DOMAIN。团队域名不含 scheme、端口或路径。应用 Audience 并非登录密钥，可以提供给开发任务；不要把邮箱验证码或 JWT 发到聊天。

worker 验证 Cf-Access-Jwt-Assertion 的 RS256 签名、issuer、audience、有效期和身份声明；不能靠隐藏管理按钮保障安全。未授权写入会被拒绝，未配置时不接受写入。workers.dev 的 Access 支持需按实际账户入口配置；若域名/路径级入口在当前账号不可用，需另行选择支持该保护方式的自有域名或认证方案，不宣称已配置成功。

## 3. 线上复验

数据库与登录配置就绪后，检查首页统计、详情浏览去重、赞踩切换与刷新、二维码和链接、管理员手机上传头像/改昵称/修改地点、未授权操作拒绝。重新部署后再次检查资料与计数仍存在。公开页面只读取已发布内容，不开放发文权限。

## 当前限制

没有 Cloudflare API 凭据，开发任务无法代建数据库、修改账号 Access 策略或执行远程迁移。以上可在网页完成，不需站主本地安装。当前只验证本地 Workerd/D1 与受控的 Access 签名令牌测试，未验证账号中的真实邮件登录。D1 使用和 Worker 请求受免费额度约束，超过额度时需重新评估费用；没有启用任何付费套餐。

正式域名、完整 CMS、图文/视频上传和 QQ 推送尚未实现。代码回滚与内容恢复分别见 operations.md。

官方资料（2026-10-14 查看）：
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
