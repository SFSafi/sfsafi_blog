# 实施进度

更新：2026-10-14（Asia/Shanghai）。新增功能分支 feature/engagement；线上自动部署分支 stage-a。

## 本轮实现

- 日期、标签、辅助提示与操作文字增大至约 12–14px，保留正文 16–17px。
- 稳定链接复制；客户端 PNG 分享卡，包含当前头像昵称、内容摘要、第一张配图、手动地点、稳定绝对链接与二维码，支持预览/保存及系统文件分享（浏览器支持时）。
- D1 阅览量：仅可见详情访问计数，同一浏览器/同一内容/上海日一次；赞踩互斥、切换与取消；并发通过 SQL 唯一约束与触发器保证统计一致。请求限制 60 次/访客/分钟，不承诺完整防刷或唯一自然人统计。
- 资料管理 /admin/profile/：头像上传、昵称、简介和个人位置；头像自动压缩，服务端独立校验；受 Cloudflare Access JWT 保护。
- 手动内容位置 /admin/locations/：站主给每条已发布内容填写、修改、移除地点，前台标签与分享卡同步；不读取访客定位。
- Worker 静态资源与 API、三个增量数据库迁移、初始 SQL、部署/运维说明与 CI。

## 已验证

类型检查 0 errors/0 warnings；Astro 构建 25 页；Worker dry-run 打包成功，约 91KB（gzip 约 24KB）。本地 D1 迁移实际应用成功，可重复执行。

16 项 Playwright 检查通过：四种宽度、主题、媒体、分页和草稿隔离；真实本地 D1 的阅览去重、并发赞与赞踩取消、限流；浏览器链接复制、二维码 PNG 下载；本地 Workerd + SQLite 的头像/昵称/地点管理、刷新与进程重启后保持、统计重启后保持；跨站/未授权/错误 Access audience/过期 JWT/SVG 上传拒绝。

Access 测试使用本地签名令牌与 JWKS 网络夹具，生产函数实际验证签名；不能把它标成账号中的真实 Cloudflare 邮箱登录验收。数据库测试为真实本地持久 SQLite，不是线上 D1。真机 Safari、线上数据库及线上账号授权未验证。

## 线上状态与阻塞

现有 https://sfsafi-blog.jonce-z.workers.dev 已检查可访问，用户确认跟踪 stage-a。

数据库相关功能暂未合入 stage-a：尚无真实 D1 ID、远程表结构和管理员 Access 团队域名/AUD 配置。仓库生产 wrangler.jsonc 的数据库占位符必须替换后才能部署。当前云机器无 Cloudflare API 凭据，不代建账号内资源，不请求聊天中的秘密值。

按用户要求尽可能独立推进：字号和复制链接/分享图片可单独先部署；数据库功能完整保存在功能分支，之后合入。

## 后续（网页操作，无需本地工具）

1. 创建 D1 sfsafi-engagement，提供非密钥数据库 UUID；在 D1 Console 执行 docs/cloudflare-schema.sql。
2. 配置管理员 Access 应用，只允许站主邮箱，覆盖 /admin/* 与 /api/admin/*；Worker 设置 ACCESS_TEAM_DOMAIN 与 ACCESS_AUD（非密钥）。
3. 配置准备后合入 stage-a，等待自动部署，复验线上统计、分享及管理员手机资料/地点操作。

完整发文 CMS、图文视频上传、评论与 QQ 推送仍未实施。代码历史不能替代数据库/头像备份。具体配置步骤见 deployment.md。
