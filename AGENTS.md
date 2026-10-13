# 项目约定

先阅读 README.md、docs/requirements.md 和 docs/progress.md。当前阶段 A，外观确认前不接真实后台。所有示例及未实现能力必须明确标识。

- 使用现有 checkout；每个云任务已隔离，未经明确要求不要创建 worktree。
- npm ci 保持锁文件；Node 24.19.0；重要逻辑使用 TypeScript。
- 页面通过 ContentRepository 访问内容，公开读取只允许 published/public。
- 稳定 ID 与 canonicalPath 不随标题改变；日期按 Asia/Shanghai 展示。
- 不在客户端嵌入凭据，不公开草稿，不把 localStorage 模拟管理当持久化。
- UI 修改运行 npm run check、npm run build；必要交互验收使用已有 Playwright 测试。
- 环境发布与正式网站发布分开；正式公开发布、付费服务及数据删除需要站主明确指令。
- 文档和代码一并维护。扩展以当前用户授权为准；不开放其他作者注册或公众发文。

## 当前已授权的扩展

用户明确要求扩大辅助字号，并新增真实阅览量、手动地点、互斥赞/踩、链接/图片分享，以及站主头像与昵称管理。这些请求优先于原任务书“第一版不包含点赞”的旧限制。此前阶段只实现这些限定后台能力；后续站主写文、评论、QQ Bot 已获需求授权，按 docs/next-features.md 分阶段交付。新增功能在 feature/engagement 开发；用户确认 Cloudflare 自动部署跟踪 stage-a。D1 ID 已配置，Worker 会自动初始化初始结构；管理员写入须 Cloudflare Access JWT 验证，不设置本地或生产认证绕过。

用户已授权公开站内 AI 搜索。密钥仅配置 Worker Secret，不提交 Git，不发送给浏览器；仅检索 published/public，回答来源必须是检索集合中的稳定链接，模型失败回退关键词。公开调用使用 D1 原子额度控制。新增 0004_search.sql 仅添加独立计数表，不修改现有数据。

正文媒体遵循 docs/media-upload.md 的站主要求：在线查看/播放优先，默认自动压缩图片、转码视频至标准档；只持久保存必要在线版本，原素材额外保留默认关闭，仍可选择压缩档位及原素材；原素材字节不变，压缩时是否额外保留原始文件由站主选择。视频压缩必须有真实转码，未实现不得伪装可用；正文上传仍为后续发文后台范围。

站主明确要求后续写文页面（仅本人可创建/编辑/发布，其他身份不能写文）、评论、更新订阅到 QQ Bot 的接口及真实 QQ Bot 部署。按 docs/next-features.md 处理权限、上线事件和部署边界；这些尚未实现，不提前声称真实投递或开通付费资源。
