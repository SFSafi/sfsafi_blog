# 架构与当前决策

## 阶段 A

Astro 7.3.8 静态输出 + TypeScript 6.0.3，原生 CSS 与小范围客户端脚本，不引入 SPA。Node 24.19.0/npm 11.9.0 已验证。版本在 package.json、锁文件与 .node-version 中固定。

`src/lib/content.ts` 定义 Post、Media、Profile、ContentRepository、PublicationEvent 与 NotificationProvider。页面不直接读取数据数组。示例适配器统一过滤 published/public；草稿样例用于验证构建隔离，不会被序列化到客户端。首次发布时间与稳定 /posts/{id}/ 保留，不按标题生成 URL。

列表使用每页 4 条，首页置顶优先，同优先级发布时间倒序。静态路径构建时迭代取得内容，不把全部正文嵌入首页。当前公开样例 7 条（动态 5 条、文章 2 条）。正文是安全的纯文本分段，bodyFormat 标为 plain；后台阶段再采用 Markdown 与可靠的服务端安全渲染。

主题：浅色、深色、青苔；系统模式响应系统深色，偏好存 localStorage。其他内容不使用 localStorage 保存。图片弹窗用原生 dialog，原图 object-fit:contain，多图缩略图 object-fit:cover，单图保留原比例。示例 SVG 可按任意显示大小清晰缩放。真实图片的响应式派生资源交给 B 阶段媒体适配器。

视频为公共领域的 MDN flower.mp4 示例，preload=none、手动播放、内联控件与无对白描述字幕。此单个约 1.1MB 演示文件可随原型保存；真实用户媒体必须接持久存储，不进入 Git。

## 后续边界

阶段 B 前依据当时官方资料比较最多两种 CMS，确认手机编辑、认证、媒体限制、费用、备份与渲染方式。尚未选定服务，也没有部署任何数据库、CMS、上传、评论或推送。静态方案需验证 Webhook、部署版本可见性与草稿隔离；立即发布则考虑按需渲染及缓存失效。接口类型只是扩展点，不表示消息发送已实现。

## 官方参考（2026-10-14 查看）

- Astro 安装：https://docs.astro.build/en/install-and-setup/
- Astro 部署：https://docs.astro.build/en/guides/deploy/
- Astro TypeScript：https://docs.astro.build/en/guides/typescript/
- 小米 MiSans：https://hyperos.mi.com/font/zh/

安装依据 npm 公布的 Astro 7.3.8 engines（Node >=22.12.0）及当前官方安装文档。运行机器和保存配置分别验证；未宣称新任务恢复或正式部署完成。
