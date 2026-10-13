# 预览与部署

当前尚无线上预览 URL。仓库为私有仓库，GitHub Pages 未开启；本环境无可用网页暴露工具或 Cloudflare/Vercel 托管凭据。不得将内部端口地址当作站主可访问的预览。

## 推荐的原型预览路径

Cloudflare Pages Git 集成：站主在 Cloudflare 网页登录，授权访问 SFSafi/sfsafi_blog，选择 stage-a 分支为预览分支。构建命令 `npm run build`，输出目录 `dist`，根目录为仓库根目录，Node 版本 `24.19.0`。当前不需要 CMS 密钥或其他环境变量。获得服务返回的实际预览地址后，检查首页、详情、主题、移动端与 404。此操作仅用于示例界面预览；如需限制访问，配置平台支持的访问控制。

Vercel 也可用 Git 集成和 Astro 静态项目预览；同样需要网页账号授权。未核实具体账号套餐，不承诺永久免费、容量或私有访问策略。

生产域名、正式上线和付费操作均未执行。真实 CMS 接入后再确定平台、适配器、缓存、Webhook 与受保护草稿预览。无需站主本地安装工具。

CI 每次 push/PR 执行 npm ci、astro check、astro build，并保存 dist 构建产物 7 天。CI 不自动正式发布；静态构建产物下载也不等同在线预览。
