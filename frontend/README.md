# 知芽 Web

Vue 3 + Vite 家长端前端，覆盖首页、绘本馆、绘本详情、软页共读、语音入口和儿童档案。

使用 Node.js 20.19+（20.x）或 22.12+：

```powershell
npm ci
npm run dev
```

开发地址为 http://127.0.0.1:5173，`/api` 请求代理至本地 FastAPI 的 8000 端口。用 `npm run build` 构建静态资源。

## 后端对齐

- `src/api/` 按 `docs/design/api-contract.md` 封装登录、儿童档案、绘本、阅读会话和语音接口，所有请求携带 Cookie，写请求读取 `zhiya_csrf` 并放入 `X-CSRF-Token`。
- 绘本列表读取 API-008，详情读取 API-009；后端没有可见的已发布绘本时，界面会明确标注并展示本地设计预览。
- 阅读会话使用 API-011、API-015、API-013 和 API-019，翻页和结束按服务端 `revision` 与 `clientEventId` 提交。
- 语音识别和合成调用 API-022、API-023；问答生成接口尚未实现，界面只展示真实识别结果，不伪造 AI 回答。
- 收藏、阅读计划和家长昵称暂无持久化接口，因此继续保存在本地，并在个人中心明确说明。

后端 Cookie 使用 `Secure`，浏览器凭据联调应使用 HTTPS；纯 HTTP 启动只适合查看本地预览和健康检查。
