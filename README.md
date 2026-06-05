# 2026 世界杯赛程与推荐

纯静态、只读的 GitHub Pages 展示站，用于呈现 2026 世界杯赛程，并为后续推荐、赛后结果和统计数据预留展示区域。

## 本地预览

在项目根目录启动任意静态服务器，例如：

```bash
python -m http.server 8080
```

然后访问 `http://127.0.0.1:8080/`。

## 数据说明

- `data/schedule.json`：OpenFootball 的 2026 World Cup JSON 本地副本。
- `js/main.js`：页面优先尝试读取 OpenFootball 远程 JSON，失败后回退到本地 JSON。
- 推荐、赔率、结算结果与 ROI 不使用占位内容填充，仅在接入数据后展示。

## 部署

将 `index.html`、`css/`、`js/`、`data/`、`assets/` 推送到 GitHub 仓库，在 Settings → Pages 中选择 `main` 分支发布即可。
