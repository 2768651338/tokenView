# TokenView · Token 管理预览系统

多渠道 LLM Token 消耗统计与高端仪表盘展示系统。

统计所有 LLM 模型服务渠道（AkuCb AI、kimi-k3、DeepSeek、智谱、火山方舟、OpenAI 等）的真实 token 使用量，从核心指标、时间趋势、渠道占比、模型排行、调用明细五个维度可视化呈现。

**零数据库依赖**：后端直接读取本地工具自带的用量数据（ZCode SQLite + Claude Code JSONL），实时计算统计，无需安装任何数据库。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + ECharts + Axios |
| 后端 | Node.js + Express（依赖仅 express + dotenv） |
| 数据访问 | Node 内置 `node:sqlite`（只读）+ JSONL 扫描 |
| 数据源 | ZCode 本地 SQLite + Claude Code 会话 JSONL（只读） |

## 功能特性

- **核心指标卡片**：累计 Token、今日消耗（含环比）、累计费用、调用次数、活跃渠道、成功率
- **消耗趋势**：按日 / 周 / 月切换，支持 Tokens / 费用 / 调用三种指标，自动填充缺失日期
- **渠道占比**：环形图展示各渠道消耗占比，tooltip 显示费用与调用数
- **模型 Top 排行**：横向渐变条形图
- **渠道排行榜**：带金/银/铜牌标识
- **调用明细**：分页表格，支持渠道 / 来源（13 工具）/ 状态 / 日期范围筛选
- **工具统计**：13 个 code 工具维度（调用 / Tokens / 费用 / 状态），无本地数据的工具可通过上报接口统计
- **实时数据**：直读数据源，各工具每次调用实时反映到仪表盘（60 秒内刷新）
- **上报接口**：业务方实时上报 token 消耗（写入本地 JSONL，立即生效）

## 快速开始

### 1. 环境要求

- Node.js ≥ 22（内置 `node:sqlite`，用于读取 ZCode 数据）
- 本机已使用 ZCode（数据在 `~/.zcode`）或 Claude Code（数据在 `~/.claude`）

### 2. 启动

```bash
# 终端 1：后端（端口 3000）
cd server && npm install && npm run dev

# 终端 2：前端（端口 5173，/api 自动代理到后端）
cd web && npm install && npm run dev
```

浏览器访问 **http://localhost:5173**，仪表盘立即展示真实用量数据。

> 数据源路径默认取用户目录，可通过 `server/.env` 覆盖（见 `.env.example`）。

## 数据接入原理

| 数据源 | 位置 | 读取方式 |
|---|---|---|
| **ZCode** | `~/.zcode/cli/db/db.sqlite`（`model_usage` 表） | 只读 SQLite 查询（WAL 模式，可与运行中的 ZCode 并发读） |
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | 扫描 assistant 消息的 usage 字段，内存缓存 |
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl` + `archived_sessions/` | token_count 事件（last_token_usage 增量）+ turn_context 模型 join |
| **WorkBuddy** | `~/.workbuddy/projects/*/*.jsonl` | providerData.rawUsage 逐调用记录（含费用 credit） |
| **LobsterAI** | `AppData\Roaming\LobsterAI\openclaw\state\agents\main\sessions\*.jsonl` | Claude Code 格式（message.usage） |
| **JoyClaw** | `AppData\Roaming\JoyClaw\state\desktop-token-usage-state.json` | 专用用量状态文件（结构就绪，暂无数据） |
| **CodeBuddy CN / Qoder** | `AppData\Roaming\*\User\globalStorage\state.vscdb` | VS Code secret 解密（DPAPI+AES-GCM，best-effort；当前缓存仅含时间戳/配额，无 token 明细） |
| **上报 API** | `server/data/reports.jsonl` | 追加写入，request_id 幂等去重，支持 tool 字段 |

- **工具统计维度**：仪表盘「工具统计」面板覆盖 13 个 code 工具（zcode / claude code / codex / CodeBuddy CN / JoyClaw / kimi / LobsterAI / OpenSquilla / qoder / Trae CN / TRAE SOLO CN / Trae / WorkBuddy），有本地数据自动采集，无本地数据的（Trae 系列、kimi、OpenSquilla 等）通过上报接口 `tool` 字段统计
- **渠道识别**：ZCode 的 provider UUID → 渠道名（读取 `~/.zcode/v2/config.json` 映射）；Claude Code 按模型名前缀推断（claude-*→Anthropic、gpt-*→OpenAI、glm-*→智谱AI、deepseek-*→DeepSeek 等）
- **实时性**：统计接口每次请求直接查询数据源，无同步延迟
- **只读安全**：不修改任何工具的数据

## API 说明

### 上报接口

业务方每次模型调用完成后上报消耗（立即生效）：

```bash
curl -X POST http://localhost:3000/api/usage/report \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "DeepSeek",
    "model": "deepseek-chat",
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "latency_ms": 850,
    "status": 1,
    "request_id": "req_20260803_001"
  }'
```

| 字段 | 必填 | 说明 |
|---|---|---|
| channel | ✅ | 渠道名称 |
| model | ✅ | 模型名称 |
| prompt_tokens | ✅ | 输入 tokens |
| completion_tokens | ✅ | 输出 tokens |
| latency_ms | 否 | 延迟毫秒数 |
| status | 否 | 1 成功 / 0 失败，默认 1 |
| request_id | 否 | 调用方请求 ID（未传自动生成；重复上报幂等忽略） |

### 统计接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats/overview?days=30` | KPI 汇总（含今日环比、区间均值） |
| GET | `/api/stats/trend?days=30&granularity=day&channel=` | 时间趋势（day / week / month） |
| GET | `/api/stats/channels?days=7` | 渠道维度统计（含占比） |
| GET | `/api/stats/models?days=7&limit=10` | 模型 Top 排行 |
| GET | `/api/stats/usage?page=1&pageSize=20&channel=&status=&start=&end=` | 调用明细分页 |
| GET | `/api/channels` | 渠道列表 |

## 费用配置

费用按**官方市场价**计算（查询时间 2026-08，美元计价模型按汇率 6.8 换算为人民币）。单价配置在 `server/src/data/prices.json`（元 / 1K tokens）：

```json
{
  "deepseek-v4-flash": { "input": 0.001, "output": 0.002 },
  "glm-5.2":           { "input": 0.008, "output": 0.028 },
  "gpt-5.6-sol":       { "input": 0.034, "output": 0.204 }
}
```

公式：`费用 = (输入tokens × 输入单价 + 输出tokens × 输出单价) / 1000`

- 未配置单价的模型费用为 0；缓存 tokens 计入总量但不参与计价
- 仪表盘「**模型市场价参考**」面板展示各模型的市场单价（元/百万 tokens）与累计费用，便于核对
- 中转渠道（AkuCb AI 等）实际收费可能低于/高于官方价，如需按实际费率计费，直接修改 prices.json 对应数值即可（保存立即生效）

## 项目结构

```
tokenView/
├── server/                  # 后端
│   ├── src/
│   │   ├── index.js         # 入口
│   │   ├── config.js        # 配置加载
│   │   ├── data/            # 数据访问层
│   │   │   ├── zcode.js     #   ZCode SQLite 只读查询
│   │   │   ├── claude-code.js # Claude Code JSONL 扫描 + 缓存
│   │   │   ├── reports.js   #   上报 JSONL 存储
│   │   │   ├── stats.js     #   三源合并聚合
│   │   │   └── prices.json  #   模型单价配置
│   │   └── routes/          # stats 统计 / usage 上报
│   └── .env.example
├── web/                     # 前端
│   └── src/
│       ├── views/Dashboard.vue
│       ├── components/      # KPI / 趋势 / 占比 / 排行 / 明细
│       ├── api/             # 接口封装
│       ├── utils/           # 格式化工具
│       └── styles/          # 深色科技风主题
└── README.md
```

## 扩展其他数据源

在 `server/src/data/` 新增模块，实现 `getRows(startMs, endMs)` 返回统一行结构数组，并在 `stats.js` 的 `getAllRows()` 中合并即可：

```js
// 统一行结构
{
  requestId: '唯一ID',          // 幂等去重键
  channel: '渠道名',
  channelKind: '供应商类型',    // openai / anthropic ...
  model: '模型名',
  source: '数据源标识',
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,                      // 由 stats 层按单价补全
  latencyMs: 0,
  status: 1,                    // 1 成功 / 0 失败
  remark: '',
  createdAt: 0                  // epoch 毫秒
}
```
