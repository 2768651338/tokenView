# TokenView · 多渠道 LLM Token 消耗仪表盘

聚合统计 **16 个 AI 编程工具**的真实 Token 用量（ZCode、Claude Code、Codex、WorkBuddy、LobsterAI 等），从核心指标、时间趋势、渠道占比、模型排行、工具维度、调用明细六个角度可视化呈现。

**桌面应用**：Electron 原生窗口运行，不依赖浏览器（v1.0.0 起提供 [安装包下载](https://github.com/2768651338/tokenView/releases/latest)）。
**零数据库依赖**：后端直接读取各工具的本地用量数据（SQLite / JSONL），实时计算统计。
**官方市场价计费**：费用按各模型官方 API 市场价自动估算，支持面板内自定义单价。

---

## ✨ 功能特性

| 模块 | 说明 |
|---|---|
| **KPI 指标卡片** | 累计 Token、今日消耗（含较昨日环比、费用）、累计费用、调用次数、活跃渠道、成功率；范围期输入 / 输出拆分 |
| **消耗趋势图** | 按日 / 周 / 月切换，Tokens / 费用 / 调用三种指标；Tokens 按输入 / 缓存 / 输出堆叠展示；固定范围叠加上期虚线对比；支持按渠道筛选 |
| **渠道占比环形图** | 各 LLM 供应商消耗占比，tooltip 显示费用与调用数 |
| **模型 Top 排行** | 横向条形图，tooltip 附市场单价 |
| **渠道排行榜** | 金/银/铜牌标识 |
| **工具统计面板** | 16 个工具渠道维度（调用 / Tokens / 费用 / 状态），无本地数据的工具可通过上报接口统计 |
| **模型市场价参考** | 全部模型的官方市场单价（元/百万 tokens）+ 累计费用核对；**支持自定义**：新增/覆盖模型单价、一键恢复默认 |
| **调用明细分页** | 渠道 / 来源（16 工具）/ 状态 / 日期范围筛选 |
| **自动刷新** | 间隔可选（关闭 / 10 秒 ~ 15 分钟），选择持久化保存 |
| **上报 API** | 业务方实时上报 token 消耗，立即生效，`tool` 字段归入工具维度；可选 `TOKENVIEW_REPORT_TOKEN` 鉴权 |
| **时段热力图** | 星期 × 小时的消耗分布（Tokens / 调用切换），看清自己的编码节奏 |
| **延迟分析** | 整体与分渠道 P50 / P95 / 均值延迟 + 首字延迟（TTFT，ZCode） |
| **会话统计** | 按 source + sessionId 聚合（ZCode / Claude Code / Codex）：标题、项目、失败、子代理调用量、代码增删行数（ZCode）、上下文水位（Codex）；点击行查看会话详情（用量汇总 + 最近消息预览，ZCode） |
| **错误与中断** | 失败率 / 失败调用 / 错误事件 / 用户中断 / 重试 / 上下文超限 KPI + 错误类型分布（rate_limited / server_error 等）+ 渠道失败排行 |
| **工具调用分析** | ZCode tool_usage 真实记录：各工具调用量、失败率、平均耗时、只读 / 破坏性标记、运行中数量 |
| **项目消耗** | 按项目目录（ZCode 会话目录 / Claude Code 与 Codex 的 cwd）统计 Tokens / 费用 / 调用、占比与代码增删行数（ZCode） |
| **月度账单** | 按月生成渠道 / 模型 / 工具分列汇总，一键导出 CSV |
| **预算告警** | 日 / 月预算，达 80% 提醒、100% 告警；顶栏横幅提示 + 桌面系统通知（每天每级最多一次） |
| **数据导出** | 调用明细按当前筛选导出 CSV / JSON（封顶 10 万行，含来源 / 项目 / TTFT / 错误类型列），价目表一键导出 CSV（含缓存价） |
| **数据源健康** | 设置页查看各数据源行数、最近使用、解密状态 |
| **ZCode 数据位置** | ZCode 数据目录被移动或自定义导致读取为空时，可在设置页手动指定 `.zcode` 根目录（桌面版可浏览选择，浏览器版粘贴路径）；库缺失时该源自动降级为空并提示，不再影响其他数据源 |
| **系统托盘** | 桌面版托盘图标（显示窗口 / 退出），可选「关闭时最小化到托盘」 |

---

## 🚀 快速开始

### 方式一：桌面应用安装包（推荐）

[从 GitHub Releases 下载](https://github.com/2768651338/tokenView/releases/latest) `TokenView-Setup.exe`（约 103 MB）——**独立桌面应用**，安装向导为同风格深色界面：

1. 双击安装（免管理员；支持从旧版原地升级，数据保留）
2. 双击桌面「TokenView」快捷方式 → 弹出 TokenView 应用窗口（内嵌服务自动启动，不再打开浏览器）
3. 关闭窗口即完全退出；控制面板可卸载

- 数据目录：`%LOCALAPPDATA%\TokenView\data\`
- 日志文件：`%LOCALAPPDATA%\TokenView\logs\`（自动记录，含实际服务端口）
- **单实例**：重复启动不会开第二个，仅聚焦已开窗口
- 外部链接自动交给系统浏览器打开

### 方式二：绿色单文件（无窗口服务模式，旧形态保留）

`server/dist/TokenView.exe`（约 90 MB，自包含 Node 运行时 + 前端 + 后端），**目标机器无需安装任何依赖**，拷贝即用；启动后自动打开浏览器，适合无窗口后台挂机场景：

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
# 桌面端开发（装配后直接弹 Electron 窗口）
cd desktop && npm install && npm run dev
```

浏览器访问 **http://localhost:5173**

---

## 📊 数据接入：16 个工具渠道

| 工具 | 数据位置（只读） | 状态 |
|---|---|---|
| ZCode | `~/.zcode/cli/db/db.sqlite`（model_usage 表） | ✅ 直读 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ 直读 |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | ✅ 直读 |
| CC Switch | `~/.cc-switch/cc-switch.db`（usage_daily_rollups 按日汇总） | ✅ 直读（与 Codex/Claude Code 渠道数据同源，存在重叠） |
| OpenCode | `~/.local/share/opencode/opencode.db`（session_message 表） | ✅ 直读（结构就绪，暂无数据） |
| WorkBuddy | `~/.workbuddy/projects/*/*.jsonl` | ✅ 直读 |
| LobsterAI | `AppData\Roaming\LobsterAI\openclaw\state\agents\main\sessions\*.jsonl` | ✅ 直读 |
| JoyClaw | `AppData\Roaming\JoyClaw\state\desktop-token-usage-state.json` | ✅ 直读（结构就绪，暂无数据） |
| CodeBuddy CN | VS Code secret storage（v10t 加密） | ⚠️ 可解密但缓存仅含时间戳，无 token 明细 |
| Qoder | VS Code secret storage（v10t 加密） | ⚠️ 可解密但缓存仅含额度配额，无 token 明细 |
| Kimi / OpenSquilla | 未安装 / 无本地数据 | 🔧 上报接口统计 |
| Trae / Trae CN / TRAE SOLO CN | 会话在服务端，本地无数据 | 🔧 上报接口统计 |
| 扣子（Coze） | 桌面端为 Web 壳，本地无用量数据 | 🔧 上报接口统计（tool=扣子） |

**原理**：`server/src/data/` 下每个工具一个适配器，`getRows(startMs, endMs)` 返回统一行结构；统计接口每次请求直查数据源，无同步延迟；全程只读，不修改任何工具数据。

**无本地数据的工具如何统计**：上报时携带 `tool` 字段即可归入对应工具维度（完整参数与校验规则见下方 [API 参考](#api-参考)）：

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
费用 = (输入tokens × 输入单价
      + 输出tokens × 输出单价
      + 缓存读tokens × 缓存读单价
      + 缓存写tokens × 缓存写单价) / 1000

缓存读/写单价：优先取 CC Switch model_pricing 表该模型的真实价（USD × 汇率换算），
未收录时按行业惯例价率估算（读 = 输入价 × 10%，写 = 输入价 × 125%）
```

- 价目共四层：**自定义 > 在线同步（modelradar）> 官方默认 > CC Switch 真实价兜底**（价表三层都未收录、但 CC Switch 记录过该模型价时，按真实价计费，面板标记「CC真实价」）
- 缓存价率可用环境变量 `TOKENVIEW_CACHE_READ_RATE` / `TOKENVIEW_CACHE_WRITE_RATE` 覆盖（仅影响未收录真实价的模型）；模型名匹配支持大小写不敏感兜底（如 `GLM-5.2` / `glm-5.2`）
- 未配置单价的模型费用为 0；各数据源的 `input_tokens` 语义不同（ZCode / Codex / CC Switch 已含缓存读，Claude Code 为纯输入），适配层已统一拆分为纯输入 + 缓存读 + 缓存写，避免重复计费
- 仪表盘「**模型市场价参考**」面板展示全部模型单价与累计费用，**支持自定义**：点「＋ 新增模型」添加价表中没有的模型，或对已有模型点「编辑」覆盖默认单价（行内带「自定义」标记，可一键「恢复默认」）；自定义价持久化于 `<数据目录>/custom-prices.json`，立即生效且重启保留
- **在线价目同步**：点「⟳ 同步在线价格」从 [modelradar.cn](https://modelradar.cn/api) 拉取全量模型官方价（美元/百万，按汇率 6.8 换算为元，可用环境变量 `MODELRADAR_FX_USD_CNY` 调整），覆盖约 300 个模型，存于 `<数据目录>/modelradar-prices.json`；面板中在线价带「在线」标记，「缓存价 读/写」列展示真实缓存价（未收录显示「估算」）
- 中转渠道实际费率不同时，除面板编辑外也可直接修改 `prices.json`（默认价表，保存立即生效）
- 上报接口响应中的费用与统计面板**同一计算口径**（`stats.computeRowCost` 单一实现）

---

## 🔌 API 参考

### 上报接口统计（无本地数据源的工具）

工具渠道分两类：**ZCode、Claude Code、Codex** 等工具的用量数据落在本地，TokenView 直读文件自动统计；而 **Kimi、OpenSquilla、Trae / Trae CN / TRAE SOLO CN、扣子（Coze）** 等工具没有本地用量明细（会话在服务端或是 Web 壳），仪表盘无法直接读取 —— 这类工具由业务方在每次 LLM 调用后调用上报接口，把用量推给 TokenView。

上报数据**实时生效**，与本地直读数据同台呈现：计入渠道占比、模型排行、调用明细，携带 `tool` 字段时归入**工具统计**维度（面板中来源标记为 `api`）。数据落盘于 `<数据目录>/reports.jsonl`，与直读数据互不影响。

#### 接口定义 `POST /api/usage/report`

- Content-Type：`application/json`
- 端口：开发模式与绿色单文件默认 `3000`；**桌面应用默认随机端口**（避免冲突），实际端口见日志文件 `%LOCALAPPDATA%\TokenView\logs\`，或启动时用 `--port` / 环境变量 `TOKENVIEW_PORT` 固定，便于业务方对接

| 字段 | 类型 | 必填 | 校验与说明 |
|---|---|---|---|
| channel | string | ✅ | LLM 渠道名称（如 `deepseek`），计入渠道占比；空则 400 |
| model | string | ✅ | 模型名称（如 `deepseek-v4-flash`）；**需与 `prices.json` 键名一致才会计费**，未配置单价的模型费用记 0；空则 400 |
| prompt_tokens | number | ✅ | 输入 tokens；负数按 0 处理 |
| completion_tokens | number | ✅ | 输出 tokens；**两者之和必须 > 0，否则 400** |
| tool | string | 否 | 工具标识（如 `Trae`、`kimi`、`扣子`），归入工具统计维度；超 32 字符截断 |
| project | string | 否 | 项目名，归入项目统计维度；超 128 字符截断 |
| remark | string | 否 | 备注（如错误信息），超 255 字符截断 |
| cache_read_tokens | number | 否 | 缓存读 tokens，默认 0；按缓存读价计费（优先 CC Switch 真实价） |
| cache_write_tokens | number | 否 | 缓存写 tokens，默认 0；按缓存写价计费（优先 CC Switch 真实价） |
| latency_ms | number | 否 | 调用延迟毫秒，默认 0，负数按 0 处理 |
| status | number | 否 | 1 成功 / 0 失败，默认 1；**非 0 值均按成功计** |
| request_id | string | 否 | 调用方幂等 ID，未传自动生成；**相同 ID 重复上报按成功幂等忽略**（网络重试安全），响应中 `data.duplicate: true` |

**上报鉴权（可选）**：设置环境变量 `TOKENVIEW_REPORT_TOKEN` 后，上报请求必须携带请求头 `x-report-token: <TOKEN>`，否则返回 401；未设置该变量时接口保持开放（本机使用场景）。

请求示例：

```bash
curl -X POST http://127.0.0.1:3000/api/usage/report \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "deepseek",
    "model": "deepseek-v4-flash",
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "tool": "Trae",
    "latency_ms": 850,
    "request_id": "req_001"
  }'
```

成功响应（费用按 `prices.json` 市场价实时估算）：

```json
{
  "code": 0,
  "message": "上报成功",
  "data": {
    "request_id": "req_001",
    "channel": "deepseek",
    "model": "deepseek-v4-flash",
    "total_tokens": 1801,
    "cost": 0.0024
  }
}
```

失败响应（HTTP 400）：`{"code":400,"message":"channel 与 model 为必填项"}`、`{"code":400,"message":"token 数量必须大于 0"}`

### 统计接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats/overview?days=30` | KPI 汇总（含今日环比、日均） |
| GET | `/api/stats/trend?days=30&granularity=day&channel=` | 时间趋势（day / week / month） |
| GET | `/api/stats/channels?days=7` | 渠道维度统计（含占比） |
| GET | `/api/stats/models?days=7&limit=10` | 模型 Top 排行（含单价） |
| GET | `/api/stats/tools` | 16 工具统计（调用 / Tokens / 费用 / 状态） |
| GET | `/api/stats/prices` | 模型市场价参考列表（含 `custom` 自定义标记与 `source` 价目来源） |
| POST | `/api/stats/prices` | 新增/修改自定义单价 `{model, input, output}`（元/1K tokens，覆盖在线价与默认价） |
| POST | `/api/stats/prices/reset` | 恢复默认单价 `{model}`（删除自定义覆盖，回落在线价/默认价） |
| POST | `/api/stats/prices/sync-modelradar` | 从 modelradar.cn 同步在线价目（手动触发，约 300 个模型） |
| GET | `/api/stats/usage?page=1&pageSize=20&channel=&source=&status=&start=&end=` | 调用明细分页 |
| GET | `/api/channels` | 渠道列表 |
| GET | `/api/stats/heatmap?days=30` | 时段热力图（星期 × 小时，tokens / calls） |
| GET | `/api/stats/latency?days=30` | 延迟分析（整体与分渠道 P50 / P95 / 均值，含 TTFT 首字延迟） |
| GET | `/api/stats/sessions?days=30&limit=20` | 会话维度统计（ZCode / Claude Code / Codex；含子代理、增删行数、上下文水位） |
| GET | `/api/stats/session/detail?session_id=&source=zcode` | 会话详情（用量汇总 + 最近消息预览，消息仅 ZCode） |
| GET | `/api/stats/errors?days=30` | 错误与中断分析（失败率 / 错误类型分布 / 中断 / 重试 / 上下文超限） |
| GET | `/api/stats/tool-usage?days=30&limit=30` | 工具调用分析（ZCode tool_usage 真实记录聚合） |
| POST | `/api/stats/settings/zcode-dir` | 设置 ZCode 数据目录 `{dir: "D:/x/.zcode"}`（空串恢复默认；要求目录下存在 `cli/db/db.sqlite`） |
| GET | `/api/stats/projects?days=30&limit=15` | 项目维度统计 |
| GET | `/api/stats/bill/months` | 有数据的月份列表 |
| GET | `/api/stats/bill?month=2026-09` | 月度账单（渠道 / 模型 / 工具分列） |
| GET | `/api/stats/budget` | 预算配置与当前状态（今日 / 本月费用、占比、告警级别） |
| POST | `/api/stats/budget` | 保存预算 `{daily, monthly, enabled}`（元，0 为不限） |
| GET | `/api/stats/health` | 数据源健康（各来源行数 / 最近使用 / 解密状态） |
| GET | `/api/stats/settings` | 应用设置（汇率覆盖值与当前生效汇率） |
| POST | `/api/stats/settings/fx` | 保存汇率覆盖 `{rate}`（`null` 清除覆盖，保存后本地重算在线价目） |
| GET | `/api/stats/usage/export?format=csv&channel=&source=&status=&start=&end=` | 明细导出（CSV / JSON，按筛选，封顶 10 万行） |
| GET | `/api/health` | 健康检查 |

---

## 🛠️ 构建与打包

```bash
# 桌面应用（推荐）：装配 + electron-packager + Inno Setup 深色安装包一条龙
cd desktop && npm install
npm run build        # 产物：desktop/release/TokenView-Setup.exe 与绿色目录 TokenView-win32-x64/
npm run dev          # 开发模式：装配后直接弹出 Electron 窗口

# 无窗口服务模式（旧形态保留）：绿色单文件 + 静默服务安装包
cd server && npm install
npm run build:exe     # 绿色单文件 → dist/TokenView.exe（需 Node 24+）
npm run build:setup   # 服务版安装包 → dist/TokenView-Setup.exe（需 Inno Setup 6）
```

桌面版流程：前端 vite 构建 → 装配 `desktop/app/`（Electron 主进程 + esbuild 服务端 bundle + 前端产物）→ @electron/packager → Inno Setup（深色自定义向导）。
服务版流程：前端构建 → 资源打包（assets.bin）→ esbuild 后端单文件 → Node SEA 注入 → postject → iscc 编译。

---

## 📁 项目结构

```
tokenView/
├── desktop/                    # 桌面端（Electron 原生窗口）
│   ├── src/main.js             # 主进程：内嵌服务启动 + 原生窗口（无边框深色、单实例、托盘）
│   ├── src/preload.js          # 预加载：暴露"关闭时最小化到托盘"开关（contextBridge）
│   ├── scripts/                # assemble.js 装配 / make-icon.js 图标 / make-installer-art.js 安装器素材
│   ├── installer/              # tokenview-desktop.iss（深色品牌化安装向导）
│   ├── assets/                 # tokenview.ico / installer-logo.bmp
│   └── release/                # 构建产物（TokenView-Setup.exe / TokenView-win32-x64/）
├── server/                     # 后端（Express，零数据库）
│   ├── src/
│   │   ├── index.js            # CLI 入口（静态托管 / 单实例 / 端口递增 / 日志）
│   │   ├── app.js              # Express 应用工厂（CLI 与桌面端共用）
│   │   ├── embed.js            # 嵌入式启动入口（桌面端使用）
│   │   ├── runtime.js          # SEA 环境适配（资源解包 / 数据目录 / 参数）
│   │   ├── config.js           # 配置加载
│   │   ├── data/               # 数据访问层
│   │   │   ├── zcode.js / claude-code.js / codex.js / workbuddy.js
│   │   │   ├── lobsterai.js / joyclaw.js / codebuddy-cn.js / qoder.js
│   │   │   ├── vscode-secret.js # VS Code secret 解密工具（DPAPI + AES-GCM）
│   │   │   ├── reports.js      # 上报存储（JSONL，幂等）
│   │   │   ├── custom-prices.js # 自定义模型单价（覆盖默认价表）
│   │   │   ├── budget.js / settings.js # 预算配置 / 应用设置（JSON 持久化）
│   │   │   ├── usage-export.js  # 明细 CSV 序列化（BOM + 公式注入转义）
│   │   │   ├── stats.js        # 多源合并聚合
│   │   │   └── prices.json     # 官方市场价配置（默认价表）
│   │   └── routes/             # stats 统计（含价格设置） / usage 上报
│   ├── scripts/                # build-exe.js / build-setup.js（服务版 SEA 构建）
│   └── installer/              # tokenview.iss（服务版静默安装包）
├── web/                        # 前端（Vue3 + Vite + ECharts）
│   └── src/
│       ├── views/Dashboard.vue
│       ├── components/         # KPI / 趋势 / 占比 / 排行 / 工具统计 / 市场价（可编辑）/ 明细
│       ├── api/ utils/ styles/
└── README.md
```

---

## ❓ 常见问题

**Q：工具显示"待上报"？**
该工具本地无用量数据（会话在云端 / 未安装 / 缓存仅含配额），通过上报接口带 `tool` 字段即可统计；工具统计面板状态会实时变为"有数据"。

**Q：费用显示不准？**
费用是按官方市场价的估算值。中转渠道（AkuCb AI 等）实际费率不同时，直接在「模型市场价参考」面板点「编辑」覆盖该模型单价（带「自定义」标记，可随时恢复默认）；也可以修改 `server/src/data/prices.json` 默认价表。

**Q：数据存在哪里？**
桌面版与安装版：`%LOCALAPPDATA%\TokenView\data\`；绿色单文件：exe 同目录 `data/`；可用 `--data-dir` 指定。自定义模型单价存于同目录 `custom-prices.json`。

**Q：桌面版的日志和端口在哪？**
日志自动记录在 `%LOCALAPPDATA%\TokenView\logs\`（含每次启动的实际端口）。桌面版内嵌服务默认使用**随机空闲端口**（仅本机回环访问，零冲突）；如需固定端口，启动时传 `--port` 或设置环境变量 `TOKENVIEW_PORT`。

**Q：端口被占用？（无窗口服务模式）**
自动递增探测（3000→3010）；或 `--port` 显式指定。

**Q：重复双击启动了多个实例？**
不会。单实例保护：第二个实例检测到已在运行，仅聚焦已开窗口后退出。

**Q：桌面版关了窗口服务就停了，想后台挂着？**
设置页勾选「关闭时最小化到托盘」：关闭窗口仅隐藏到托盘，服务继续运行；退出请从托盘右键菜单选择。默认保持关闭即退出的原行为。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + ECharts + Axios |
| 后端 | Node.js + Express（依赖仅 express + dotenv） |
| 数据访问 | Node 内置 `node:sqlite` + JSONL 扫描（只读） |
| 桌面端 | Electron 43（无边框窗口 + 内嵌服务）+ @electron/packager |
| 单文件打包 | Node SEA + esbuild + postject |
| 安装包 | Inno Setup 6（深色自定义向导 + 品牌侧栏） |
