# SFSafi 的个人空间

Astro + TypeScript，手机优先的 SNS 风格个人空间。当前内容仍含样例。新增 D1 文字写文、草稿/发布/撤回与评论审核；管理员需配置 Cloudflare Access，写文和审核再次核对唯一站主邮箱。独立 QQ Bot 已准备部署，但尚无真实账号凭据。新增 /search/ 站内搜索支持关键词和由站主配置的 OpenAI 兼容 AI 接口，配置见 docs/ai-search.md。

## 云端开发

Node.js 24.19.0，npm 11.9.0；Astro 7.3.8、TypeScript 6.0.3。只使用 npm 和已提交的 package-lock.json。站主无需在本地安装工具。

```sh
cd /workspace/sfsafi_blog
npm ci --no-audit --no-fund
npm run dev -- --port 4321
```

```sh
npm run check
npm run build
PLAYWRIGHT_BROWSERS_PATH=/tmp/sfsafi-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/sfsafi-browsers npm run test:e2e
```

本地后端：先 npm run build:worker，再 npm run db:local、npm run dev:worker。它使用本地 D1，数据保存在忽略的 .wrangler/，并非生产存储。

生产构建位于 dist/。`npm run preview -- --port 4321` 仅用于内部验证。对外预览需要托管平台，不能把开发服务器当作正式网站。

## 页面

- `/` 首页：置顶优先、发布时间倒序，每页最多 4 条。
- `/page/2/` 更早的记录；数据增加时自动生成更多页。
- `/posts/{id}/` 稳定详情链接，文章也沿用该路径。
- `/articles/` 长文；`/tags/` 标签；`/tags/{tag}/` 分类；`/about/` 关于我；`/404.html` 未找到页面。

三种主题与系统模式；只把主题偏好存入 localStorage。图片组用方形缩略图，单图保留比例；弹窗原图完整展示，支持键盘、关闭与焦点归还。视频不自动播放、preload=none，失败支持重试。

## 文档

[需求](docs/requirements.md) · [架构](docs/architecture.md) · [进度](docs/progress.md) · [部署](docs/deployment.md) · [运维](docs/operations.md) · [媒体和字体来源](docs/licenses.md) · [媒体上传需求](docs/media-upload.md) · [写文与评论](docs/writing.md) · [QQ Bot 部署](docs/qq-bot.md) · [原后续范围](docs/next-features.md)

Bot 单独打包：npm run build:bot。当前总检查需先 build:worker 与 build:bot，再运行 test:e2e；Bot 不用博客的部署配置。

视频转码：独立 FFmpeg 服务与站主 `/admin/media/` 页面已实现，见 [部署说明](docs/ffmpeg.md)。真实服务器与 R2 尚未接通，不能直接发布正文视频。服务使用 Python 3.11+、FFmpeg/ffprobe；真实编码检查命令：`python3 -m unittest discover -s transcoder -p 'test_*.py' -v`。
