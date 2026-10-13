# 当前网站部署

当前地址 https://sfsafi-blog.jonce-z.workers.dev ，用户确认通过 Cloudflare Workers Git 集成跟踪 stage-a 自动部署。现有部署配置已工作；本轮字号/分享界面保持原有纯静态构建方式，npm run build 输出 dist，不修改当前 Worker 的线上绑定或启用收费服务。

feature/engagement 分支提供真实 D1 统计、资料管理和手动地点编辑；其生产 wrangler.jsonc 尚缺数据库 ID，暂不可合入部署分支。

用户醒来后的网页操作：Cloudflare 存储与数据库 → D1，创建 sfsafi-engagement，将非密钥数据库 UUID 提供给开发任务。完整数据库初始化、Access 邮箱登录与后续部署步骤在后台分支：
https://github.com/SFSafi/sfsafi_blog/blob/feature/engagement/docs/deployment.md

不需要本地安装 Node，也不发送 API Token、邮箱验证码或登录 JWT 到聊天。云环境发布与网站自动部署仍是两件独立操作。
