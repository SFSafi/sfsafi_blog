# 项目约定

先阅读 README.md、docs/requirements.md 和 docs/progress.md。当前阶段 A，外观确认前不接真实后台。所有示例及未实现能力必须明确标识。

- 使用现有 checkout；每个云任务已隔离，未经明确要求不要创建 worktree。
- npm ci 保持锁文件；Node 24.19.0；重要逻辑使用 TypeScript。
- 页面通过 ContentRepository 访问内容，公开读取只允许 published/public。
- 稳定 ID 与 canonicalPath 不随标题改变；日期按 Asia/Shanghai 展示。
- 不在客户端嵌入凭据，不公开草稿，不把 localStorage 模拟管理当持久化。
- UI 修改运行 npm run check、npm run build；必要交互验收使用已有 Playwright 测试。
- 环境发布与正式网站发布分开；正式公开发布、付费服务及数据删除需要站主明确指令。
- 文档和代码一并维护。不要添加未经确认的评论、QQ、点赞或公众注册功能。
