# TokenView · 多渠道 LLM Token 消耗仪表盘

聚合统计 **14 个 AI 编程工具**的真实 Token 用量（ZCode、Claude Code、Codex、WorkBuddy、LobsterAI 等），从核心指标、时间趋势、渠道占比、模型排行、工具维度、调用明细六个角度可视化呈现。

**零数据库依赖**：后端直接读取各工具的本地用量数据（SQLite / JSONL），实时计算统计。
**官方市场价计费**：费用按各模型官方 API 市场价自动估算。

---

## ✨ 功能特性

| 模块 | 说明 |
|---|---|
| **KPI 指标卡片** | 累计 Token、今日消耗（含较昨日环比）、累计费用、调用次数、活跃渠道、成功率 |
| **消耗趋势图** | 按日 / 周 / 月切换，支持 Tokens / 费用 / 调用三种指标 |
| **渠道占比环形图** | 各 LLM 供应商消耗占比，tooltip 显示费用与调用数 |
| **模型 Top 排行** | 横向条形图，tooltip 附市场单价 |
| **渠道排行榜** | 金/银/铜牌标识 |
| **工具统计面板** | 14 个工具渠道维度（调用 / Tokens / 费用 / 状态），无本地数据的工具可通过上报接口统计 |
| **模型市场价参考** | 全部模型的官方市场单价（元/百万 tokens）+ 累计费用核对 |
| **调用明细分页** | 渠道 / 来源（13 工具）/ 状态 / 日期范围筛选 |
| **上报 API** | 业务方实时上报 token 消耗，立即生效，`tool` 字段归入工具维度 |

---

## 🚀 快速开始

### 方式一：安装包（推荐，一体化产品形态）

`TokenView-Setup.exe`（约 24 MB）——安装向导、桌面/开始菜单快捷方式、无黑窗口静默运行：

1. 双击安装（安装到 `%LOCALAPPDATA%\Programs\TokenView`，免管理员）
2. 双击桌面「TokenView」快捷方式 → 服务静默启动，自动打开浏览器
3. 用完在任务栏/任务管理器结束进程，或控制面板卸载

- 数据目录：`%LOCALAPPDATA%\TokenView\data\`
- 日志文件：`%LOCALAPPDATA%\TokenView\logs\`（`--log` 文件日志）
- **单实例**：重复启动不会开第二个服务，仅打开浏览器到已运行实例

### 方式二：绿色单文件

`TokenView.exe`（约 90 MB，自包含 Node 运行时 + 前端 + 后端），**目标机器无需安装任何依赖**，拷贝即用：

```
TokenView.exe                      # 双击启动（控制台窗口显示日志，关闭即退出）
TokenView.exe --port 8080          # 指定端口（被占用时自动递增 3000→3010）
TokenView.exe --no-browser         # 不自动打开浏览器
TokenView.exe --log                # 启用文件日志（logs/ 目录）
TokenView.exe --data-dir <目录>     # 指定数据目录
```

数据默认写入 exe 同目录 `data/`（绿色便携），不可写时回退 `%LOCALAPPDATA%\TokenView\data`。

### 方式三：开发模式

```bash
# 终端 1：后端（端口 3000）
cd server && npm install && npm run dev
# 终端 2：前端（端口 5173，/api 自动代理到后端）
cd web && npm install && npm run dev
```

浏览器访问 **http://localhost:5173**

---

## 📊 数据接入：14 个工具渠道

| 工具 | 数据位置（只读） | 状态 |
|---|---|---|
| ZCode | `~/.zcode/cli/db/db.sqlite`（model_usage 表） | ✅ 直读 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ 直读 |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | ✅ 直读 |
| WorkBuddy | `~/.workbuddy/projects/*/*.jsonl` | ✅ 直读 |
| LobsterAI | `AppData\Roaming\LobsterAI\openclaw\state\agents\main\sessions\*.jsonl` | ✅ 直读 |
| JoyClaw | `AppData\Roaming\JoyClaw\state\desktop-token-usage-state.json` | ✅ 直读（结构就绪，暂无数据） |
| CodeBuddy CN | VS Code secret storage（v10t 加密） | ⚠️ 可解密但缓存仅含时间戳，无 token 明细 |
| Qoder | VS Code secret storage（v10t 加密） | ⚠️ 可解密但缓存仅含额度配额，无 token 明细 |
| Kimi / OpenSquilla | 未安装 / 无本地数据 | 🔧 上报接口统计 |
| Trae / Trae CN / TRAE SOLO CN | 会话在服务端，本地无数据 | 🔧 上报接口统计 |
| 扣子（Coze） | 桌面端为 Web 壳，本地无用量数据 | 🔧 上报接口统计（tool=扣子） |

**原理**：`server/src/data/` 下每个工具一个适配器，`getRows(startMs, endMs)` 返回统一行结构；统计接口每次请求直查数据源，无同步延迟；全程只读，不修改任何工具数据。

**无本地数据的工具如何统计**：上报时携带 `tool` 字段即可归入对应工具维度：

```bash
curl -X POST http://localhost:3000/api/usage/report \
  -H "Content-Type: application/json" \
  -d '{"channel":"DeepSeek","model":"deepseek-chat",
       "prompt_tokens":1234,"completion_tokens":567,
       "tool":"Trae","request_id":"req_001"}'
```

---

## 💰 费用：按官方市场价计算

真实数据只有 token 数、没有价格，费用按 `server/src/data/prices.json` 中的**官方市场价**（元 / 1K tokens，2026-08 查询，美元计价按汇率 6.8 换算）估算：

```json
{
  "deepseek-v4-flash": { "input": 0.001, "output": 0.002 },
  "glm-5.2":           { "input": 0.008, "output": 0.028 },
  "gpt-5.6-sol":       { "input": 0.034, "output": 0.204 }
}
```

```
费用 = (输入tokens × 输入单价 + 输出tokens × 输出单价) / 1000
```

- 未配置单价的模型费用为 0；缓存 tokens 计入总量但不参与计价
- 仪表盘「**模型市场价参考**」面板展示全部模型单价与累计费用
- 中转渠道实际费率不同时，直接修改 `prices.json` 即可（保存立即生效）

---

## 🔌 API 参考

### 上报接口 `POST /api/usage/report`

| 字段 | 必填 | 说明 |
|---|---|---|
| channel | ✅ | 渠道名称（LLM 供应商） |
| model | ✅ | 模型名称 |
| prompt_tokens | ✅ | 输入 tokens |
| completion_tokens | ✅ | 输出 tokens |
| tool | 否 | 工具标识（Trae / kimi 等，归入工具统计维度） |
| latency_ms | 否 | 延迟毫秒数 |
| status | 否 | 1 成功 / 0 失败，默认 1 |
| request_id | 否 | 调用方 ID（未传自动生成；重复上报幂等忽略） |

### 统计接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats/overview?days=30` | KPI 汇总（含今日环比、日均） |
| GET | `/api/stats/trend?days=30&granularity=day&channel=` | 时间趋势（day / week / month） |
| GET | `/api/stats/channels?days=7` | 渠道维度统计（含占比） |
| GET | `/api/stats/models?days=7&limit=10` | 模型 Top 排行（含单价） |
| GET | `/api/stats/tools` | 13 工具统计（调用 / Tokens / 费用 / 状态） |
| GET | `/api/stats/prices` | 模型市场价参考列表 |
| GET | `/api/stats/usage?page=1&pageSize=20&channel=&source=&status=&start=&end=` | 调用明细分页 |
| GET | `/api/channels` | 渠道列表 |
| GET | `/api/health` | 健康检查 |

---

## 🛠️ 构建与打包

```bash
cd server && npm install

npm run build:exe     # 绿色单文件 → dist/TokenView.exe（需 Node 24+）
npm run build:setup   # 安装包 → dist/TokenView-Setup.exe（需 Inno Setup 6）
```

构建流程：前端 `npm run build` → 资源打包（assets.bin）→ esbuild 后端单文件 → Node SEA 注入 → postject 注入 blob →（安装包）iscc 编译。

---

## 📁 项目结构

```
tokenView/
├── server/                     # 后端（Express，零数据库）
│   ├── src/
│   │   ├── index.js            # 入口（静态托管 / 单实例 / 端口递增 / 日志）
│   │   ├── runtime.js          # SEA 环境适配（资源解包 / 数据目录 / 参数）
│   │   ├── config.js           # 配置加载
│   │   ├── data/               # 数据访问层
│   │   │   ├── zcode.js / claude-code.js / codex.js / workbuddy.js
│   │   │   ├── lobsterai.js / joyclaw.js / codebuddy-cn.js / qoder.js
│   │   │   ├── vscode-secret.js # VS Code secret 解密工具（DPAPI + AES-GCM）
│   │   │   ├── reports.js      # 上报存储（JSONL，幂等）
│   │   │   ├── stats.js        # 多源合并聚合
│   │   │   └── prices.json     # 官方市场价配置
│   │   └── routes/             # stats 统计 / usage 上报
│   ├── scripts/                # build-exe.js / build-setup.js
│   ├── installer/              # tokenview.iss + TokenView-run.vbs
│   └── dist/                   # 构建产物（TokenView.exe / TokenView-Setup.exe）
├── web/                        # 前端（Vue3 + Vite + ECharts）
│   └── src/
│       ├── views/Dashboard.vue
│       ├── components/         # KPI / 趋势 / 占比 / 排行 / 工具统计 / 市场价 / 明细
│       ├── api/ utils/ styles/
└── README.md
```

---

## ❓ 常见问题

**Q：工具显示"待上报"？**
该工具本地无用量数据（会话在云端 / 未安装 / 缓存仅含配额），通过上报接口带 `tool` 字段即可统计；工具统计面板状态会实时变为"有数据"。

**Q：费用显示不准？**
费用是按官方市场价的估算值。中转渠道（AkuCb AI 等）实际费率不同时，修改 `server/src/data/prices.json` 对应模型单价即可。

**Q：数据存在哪里？**
安装版：`%LOCALAPPDATA%\TokenView\data\reports.jsonl`；绿色版：exe 同目录 `data/`；可用 `--data-dir` 指定。日志：`--log` 参数启用后写入 `<数据目录上级>/logs/`。

**Q：端口被占用？**
自动递增探测（3000→3010）；或 `--port` 显式指定。

**Q：重复双击启动了多个实例？**
单实例保护：第二个实例检测到已在运行，仅打开浏览器后退出。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + ECharts + Axios |
| 后端 | Node.js + Express（依赖仅 express + dotenv） |
| 数据访问 | Node 内置 `node:sqlite` + JSONL 扫描（只读） |
| 单文件打包 | Node SEA + esbuild + postject |
| 安装包 | Inno Setup 6 |
