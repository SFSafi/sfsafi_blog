# 架构与当前决策

## 阶段 A

Astro 7.3.8 静态输出 + TypeScript 6.0.3，原生 CSS 与小范围客户端脚本，不引入 SPA。Node 24.19.0/npm 11.9.0 已验证。版本在 package.json、锁文件与 .node-version 中固定。

`src/lib/content.ts` 定义 Post、Media、Profile、ContentRepository、PublicationEvent 与 NotificationProvider。页面不直接读取数据数组。示例适配器统一过滤 published/public；草稿样例用于验证构建隔离，不会被序列化到客户端。首次发布时间与稳定 /posts/{id}/ 保留，不按标题生成 URL。

列表使用每页 4 条，首页置顶优先，同优先级发布时间倒序。静态路径构建时迭代取得内容，不把全部正文嵌入首页。当前公开样例 7 条（动态 5 条、文章 2 条）。正文是安全的纯文本分段，bodyFormat 标为 plain；后台阶段再采用 Markdown 与可靠的服务端安全渲染。

主题：浅色、深色、青苔；系统模式响应系统深色，偏好存 localStorage。其他内容不使用 localStorage 保存。图片弹窗用原生 dialog，原图 object-fit:contain，多图缩略图 object-fit:cover，单图保留原比例。示例 SVG 可按任意显示大小清晰缩放。真实图片的响应式派生资源交给 B 阶段媒体适配器。

视频为公共领域的 MDN flower.mp4 示例，preload=none、手动播放、内联控件与无对白描述字幕。此单个约 1.1MB 演示文件可随原型保存；真实用户媒体必须接持久存储，不进入 Git。

## 后续边界

阶段 B 前依据当时官方资料比较最多两种 CMS，确认手机编辑、认证、媒体限制、费用、备份与渲染方式。正文 CMS/媒体存储尚未选定；D1 互动与资料 API 已部署，但文字写文和评论已通过 D1 实现；正文上传及真实 QQ 部署/投递仍待完成，详见最新实现章节。静态方案需验证 Webhook、部署版本可见性与草稿隔离；立即发布则考虑按需渲染及缓存失效。接口类型只是扩展点，不表示消息发送已实现。

## 官方参考（2026-10-14 查看）

- Astro 安装：https://docs.astro.build/en/install-and-setup/
- Astro 部署：https://docs.astro.build/en/guides/deploy/
- Astro TypeScript：https://docs.astro.build/en/guides/typescript/
- 小米 MiSans：https://hyperos.mi.com/font/zh/

安装依据 npm 公布的 Astro 7.3.8 engines（Node >=22.12.0）及当前官方安装文档。运行机器和保存配置分别验证；未宣称新任务恢复或正式部署完成。

## 用户授权的互动与资料扩展

Astro 保留静态页面，worker/index.ts 接受 /api/* 请求并通过 ASSETS 返回静态资源。生产配置 wrangler.jsonc 已填写站主提供的真实 D1 ID；wrangler.local.jsonc 仅用于本地 Workerd/D1，不得部署其模拟 UUID。compatibility_date 保守使用 2026-06-01，以兼容当前稳定测试运行时，不依赖未来日期。

D1 表：visitors 仅存随机 HttpOnly Cookie 的 SHA-256 哈希；views 的 (post_id, visitor_id, day) 唯一键按上海日去重；votes 的 (post_id, visitor_id) 唯一键确保赞/踩互斥。触发器在同一事务维护 post_stats，切换/取消不会重复累计。rate_limits 每访客一分钟最多 60 次统计操作；这不是自然人身份校验或完整防刷，换浏览器/清 Cookie 会被视为新访客。公开记录以稳定 ID 关联，草稿在接口层被拒绝。列表仅读取统计；可见的详情页记录浏览。

资料管理使用 Cloudflare Access，而非自行编写密码系统。通过 jose 验证 RS256 签名、issuer、audience、有效期；只有管理员应用 Allow 策略授权的登录能得到可用断言。写请求检查同源 Origin。头像客户端缩为最多 512px、WebP/200KB，服务端独立验证 MIME、文件头/尺寸、16–1024px 与 200KB 限制。仅允许 JPEG/PNG/WebP，不接受 SVG。profile 与小头像 BLOB 存入 D1，头像使用不可变版本 URL；此小规模头像能力不用于大量照片或视频。

post_locations 保存站主手动填写地点的覆盖值，留空移除。管理员管理现有已发布样例的地点；正式发文 CMS 接入后可把字段合并进 CMS 数据模型。公开页面异步读取地点，地点目录按标签展示稳定内容链接，不获取访客定位。昵称和头像也由公开资料 API 更新；静态 HTML 的 SEO 与禁用 JS 回退仍为构建时样例，后续正式 CMS 再统一渲染。

分享功能完全在浏览器生成 PNG，使用当前公开头像昵称、地点、摘要、稳定绝对 URL 与二维码；不上传分享图片。正文摘要上限 600 字，多图只取第一张作为分享配图；完整内容通过链接访问。复制失败提供手动复制入口，系统支持文件分享时显示系统分享按钮。

初始数据库结构通过 Worker 请求时幂等 bootstrap，按版本进行批量事务创建，仅支持初始加法迁移；npm prepare 从迁移文件生成忽略的 SQL 模块。新数据库与进程重启场景纳入测试。未来非初始迁移仍需单独评审，不自动运行删除/改写数据的 SQL。

Wrangler 固定 4.100.0（配套稳定 Miniflare 4），避免当前最新 CLI 的 beta 本地开发 SDK 在反复重建时留下监听端口。该日期与稳定运行时兼容，所用 D1/Assets/Web Crypto 能力均已支持。

## 正文媒体处理要求

站主最新要求见 [media-upload.md](media-upload.md)：在线阅读/播放优先，上传提供压缩档位及原素材选项，原文件与阅读/播放派生版本分别存储。图片与视频默认自动处理为标准档；默认只持久保存在线版本及必要缩略图/封面，原素材额外保留默认关闭。视频自动转码是正文上传上线的必要能力，未接通时不能自动回退为上传原视频。尚未实现正文媒体上传或选择 CMS/对象存储，现有头像 BLOB 不扩展成通用媒体库。

## 后续写文、评论与 QQ Bot

这些已纳入站主确认的后续范围，细则见 [next-features.md](next-features.md)。规划站主专属写文页面与独立评论权限；持久发布事件确认对应内容版本上线后通知 Bot。QQ Bot 是独立运行部署，签名接收事件、持久化投递，真实渠道能力及费用须实施时核实。现有 PublicationEvent/NotificationProvider 仍仅为类型扩展点。

## D1 文字发布与评论实现（2026-10-14）

限定单人编辑方案比较与选择见 writing.md。contents 保存实际正文，Worker 使用 D1 ContentRepository 渲染公开首页/分页/详情/标签，模板只保存布局与脚本，不保存私有正文。公开读取只允许 published/public，发布不等待静态重建，撤回/归档后不通过静态详情别名绕过。样例首次 INSERT OR IGNORE 导入，保留所有原统计/资料。0005/0006 仅新增内容、发布事件与评论表。

站主 API 验证 Access 签名和 OWNER_EMAIL，客户端禁用按钮不是权限边界。Markdown 原始 HTML 与不安全链接被拒绝执行，远程 Markdown 图片暂不渲染。评论待审核、一级回复，唯一站主审核/回复；昵称不等于认证。

网站 publication_outbox 通过签名接口通知独立 Bot Worker，qq_* 表持久保存订阅/投递；两服务复用已有 D1，但代码/部署配置独立。QQ 官方 HTTP Webhook 使用真实 Ed25519 校验，Node crypto 在 nodejs_compat 下本地 Workerd 验证通过。真实平台账号授权与服务部署仍未完成，见 qq-bot.md。R2 与正文媒体上传按用户指示暂缓。

## FFmpeg 接入（2026-10-14）

站主要求接入真实 FFmpeg，并确认暂时没有服务器，先完成代码/部署说明。`transcoder/service.py` 为独立服务，SQLite 持久任务、受限 FFmpeg 子进程、私有持久卷；`worker/media.ts` 仅站主鉴权后代理上传/任务/Range，不将服务密钥发送给浏览器。`/admin/media/` 默认标准自动转码、可选档位和保留原素材，支持任务 URL 恢复、实际大小和私有播放预览。Docker Compose 与维护步骤见 ffmpeg.md。R2、公开媒体读取、正文绑定尚未实现，发布仍只接受原有文字，不把私有转码结果标为公开媒体。
