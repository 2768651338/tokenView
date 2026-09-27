<template>
  <div>
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="13" width="4.5" height="8" rx="1.5" fill="currentColor" opacity="0.55"/>
            <rect x="9.75" y="8" width="4.5" height="13" rx="1.5" fill="currentColor" opacity="0.8"/>
            <rect x="16.5" y="3" width="4.5" height="18" rx="1.5" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h1>TokenView</h1>
          <div class="sub">多渠道 Token 消耗监控中心</div>
        </div>
      </div>
      <div class="topbar-right">
        <div class="seg">
          <button
            v-for="d in dayOptions" :key="d"
            :class="{ active: days === d }"
            @click="setDays(d)"
          >{{ d === 'all' ? '全部' : `近 ${d} 天` }}</button>
        </div>
        <select
          class="refresh-select"
          :value="refreshInterval"
          title="自动刷新间隔"
          @change="setRefreshInterval($event.target.value)"
        >
          <option v-for="o in refreshOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="refresh-btn" :disabled="loading" @click="refreshAll">
          {{ loading ? '刷新中...' : '⟳ 刷新' }}
        </button>
        <button class="refresh-btn" title="设置（预算 / 汇率 / 数据源健康）" @click="showSettings = true">设置</button>
      </div>
    </header>

    <!-- 预算告警横幅 -->
    <div v-if="budget && budget.level && budget.level !== 'none'" class="budget-banner" :class="budget.level">
      <template v-if="budgetBannerText">{{ budgetBannerText }}</template>
      <button class="budget-banner-btn" @click="showSettings = true">调整预算</button>
    </div>

    <!-- KPI 卡片 -->
    <KpiCards :overview="overview" />

    <!-- 趋势 + 占比 -->
    <div class="main-grid">
      <TrendChart
        :trend="trend"
        :granularity="granularity"
        :channel="trendChannel"
        :channel-list="channelList"
        @granularity-change="setGranularity"
        @channel-change="setTrendChannel"
      />
      <ChannelPie :channels="channels" />
    </div>

    <!-- 排行 + 模型 Top -->
    <div class="lower-grid">
      <TopRank :channels="channels" />
      <ModelBar :models="models" />
    </div>

    <!-- 时段热力图 + 延迟分析 -->
    <div class="lower-grid hm-grid">
      <Heatmap :data="heatmap" :days="days" />
      <LatencyStats :data="latency" :days="days" />
    </div>

    <!-- 会话统计（宽表：会话/项目/子代理/上下文/增删 + 详情） -->
    <div style="padding: 0 28px 20px;">
      <SessionStats :list="sessions.list" :total="sessions.total" :days="days" />
    </div>

    <!-- 错误与中断 + 工具调用分析 -->
    <div class="lower-grid">
      <ErrorStats :data="errors" :days="days" />
      <ToolUsage :list="toolUsage.list" :days="days" />
    </div>

    <!-- 项目消耗 + 月度账单 -->
    <div class="lower-grid">
      <ProjectStats :list="projects" />
      <BillPanel />
    </div>

    <!-- 工具统计 + 模型市场价参考（两列紧凑并排） -->
    <div class="lower-grid">
      <ToolStats :tools="tools" />
      <PriceTable :data="prices" @refresh="loadPrices" />
    </div>

    <!-- 明细 -->
    <div style="padding: 0 28px 24px;">
      <UsageTable
        :list="usage.list"
        :total="usage.total"
        :page="usage.page"
        :page-size="usage.pageSize"
        :channel-list="channelList"
        :source-options="sourceOptions"
        @page-change="setUsagePage"
        @filter-change="setUsageFilter"
        @refresh="loadUsage"
      />
    </div>

    <footer style="text-align:center;color:var(--text-faint);font-size:11px;padding-bottom:20px;">
      TokenView · © 田小橙 QQ2768651338 · {{ refreshLabel }}
    </footer>

    <!-- 设置弹窗 -->
    <SettingsModal :visible="showSettings" @close="showSettings = false" @budget-changed="loadBudget" @data-changed="refreshAll" />
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import KpiCards from '../components/KpiCards.vue';
import TrendChart from '../components/TrendChart.vue';
import ChannelPie from '../components/ChannelPie.vue';
import ModelBar from '../components/ModelBar.vue';
import TopRank from '../components/TopRank.vue';
import ToolStats from '../components/ToolStats.vue';
import PriceTable from '../components/PriceTable.vue';
import UsageTable from '../components/UsageTable.vue';
import Heatmap from '../components/Heatmap.vue';
import LatencyStats from '../components/LatencyStats.vue';
import ProjectStats from '../components/ProjectStats.vue';
import BillPanel from '../components/BillPanel.vue';
import SessionStats from '../components/SessionStats.vue';
import ErrorStats from '../components/ErrorStats.vue';
import ToolUsage from '../components/ToolUsage.vue';
import SettingsModal from '../components/SettingsModal.vue';
import {
  fetchOverview, fetchTrend, fetchChannels, fetchModels,
  fetchUsage, fetchChannelList, fetchPrices, fetchTools,
  fetchHeatmap, fetchLatency, fetchProjects, fetchBudget,
  fetchSessions, fetchErrors, fetchToolUsage
} from '../api';
import { fmtCost } from '../utils/format';

const dayOptions = [7, 30, 90, 'all'];
const days = ref(7);
const granularity = ref('day');
const trendChannel = ref('');
const loading = ref(false);
const showSettings = ref(false);

const overview = ref({});
const trend = ref({ list: [] });
const channels = ref([]);
const models = ref([]);
const prices = ref({ list: [] });
const tools = ref([]);
const channelList = ref([]);
const heatmap = ref({ list: [], max_tokens: 0, max_calls: 0 });
const latency = ref({ overall: null, channels: [], ttft: { overall: null, channels: [] } });
const projects = ref([]);
const budget = ref(null);
const sessions = ref({ list: [], total: 0 });
const errors = ref({});
const toolUsage = ref({ list: [] });

const usage = reactive({ list: [], total: 0, page: 1, pageSize: 20 });
const usageFilter = reactive({ channel: '', source: '', status: '', start: '', end: '' });

// 来源筛选选项（16 工具 + api）
const sourceOptions = [
  { id: 'zcode', name: 'ZCode' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'cc-switch', name: 'CC Switch' },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN' },
  { id: 'joyclaw', name: 'JoyClaw' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'lobsterai', name: 'LobsterAI' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'opensquilla', name: 'OpenSquilla' },
  { id: 'qoder', name: 'Qoder' },
  { id: 'trae', name: 'Trae' },
  { id: 'trae-cn', name: 'Trae CN' },
  { id: 'trae-solo-cn', name: 'TRAE SOLO CN' },
  { id: 'workbuddy', name: 'WorkBuddy' },
  { id: 'coze', name: '扣子' },
  { id: 'api', name: '上报接口' }
];

let timer = null;

// ---- 自动刷新间隔（秒），0 = 关闭；选择持久化到 localStorage ----
const REFRESH_STORAGE_KEY = 'tokenview-refresh-interval';
const REFRESH_DEFAULT = 60;
const refreshOptions = [
  { value: 0, label: '关闭自动刷新' },
  { value: 10, label: '每 10 秒' },
  { value: 30, label: '每 30 秒' },
  { value: 60, label: '每 60 秒' },
  { value: 300, label: '每 5 分钟' },
  { value: 900, label: '每 15 分钟' }
];

function loadRefreshInterval() {
  try {
    const raw = localStorage.getItem(REFRESH_STORAGE_KEY);
    if (raw === null) return REFRESH_DEFAULT; // 从未设置过（Number(null) 是 0，不能直接转换）
    const v = Number(raw);
    if (refreshOptions.some((o) => o.value === v)) return v;
  } catch { /* localStorage 不可用时回退默认值 */ }
  return REFRESH_DEFAULT;
}

const refreshInterval = ref(loadRefreshInterval());
const refreshLabel = computed(() => {
  const v = refreshInterval.value;
  if (!v) return '自动刷新已关闭';
  if (v >= 60 && v % 60 === 0) return `每 ${v / 60} 分钟自动刷新`;
  return `每 ${v} 秒自动刷新`;
});

function setRefreshInterval(v) {
  const n = Number(v);
  // 防呆：非法值一律回退默认间隔
  refreshInterval.value = refreshOptions.some((o) => o.value === n) ? n : REFRESH_DEFAULT;
  try { localStorage.setItem(REFRESH_STORAGE_KEY, String(refreshInterval.value)); } catch { /* 忽略写入失败 */ }
  restartTimer();
}

function restartTimer() {
  if (timer) { clearInterval(timer); timer = null; }
  if (refreshInterval.value > 0) {
    timer = setInterval(() => {
      // 明细表不参与自动刷新，避免打断翻页
      refreshAll();
    }, refreshInterval.value * 1000);
  }
}

async function loadOverview() {
  overview.value = await fetchOverview(days.value);
}
async function loadTrend() {
  trend.value = await fetchTrend({ days: days.value, granularity: granularity.value, channel: trendChannel.value });
}
async function loadChannels() {
  channels.value = await fetchChannels(days.value);
}
async function loadModels() {
  models.value = await fetchModels(days.value, 10);
}
async function loadPrices() {
  prices.value = await fetchPrices();
}
async function loadTools() {
  tools.value = await fetchTools();
}
async function loadHeatmap() {
  heatmap.value = await fetchHeatmap(days.value);
}
async function loadLatency() {
  latency.value = await fetchLatency(days.value);
}
async function loadProjects() {
  projects.value = await fetchProjects(days.value, 15);
}
async function loadSessions() {
  sessions.value = await fetchSessions(days.value, 20);
}
async function loadErrors() {
  errors.value = await fetchErrors(days.value);
}
async function loadToolUsage() {
  toolUsage.value = await fetchToolUsage(days.value, 30);
}
async function loadBudget() {
  budget.value = await fetchBudget();
  maybeNotifyBudget();
}
async function loadUsage() {
  const data = await fetchUsage({
    page: usage.page,
    pageSize: usage.pageSize,
    ...usageFilter
  });
  usage.list = data.list;
  usage.total = data.total;
}

async function loadChannelList() {
  channelList.value = await fetchChannelList();
}

async function refreshAll() {
  loading.value = true;
  try {
    await Promise.all([
      loadOverview(), loadTrend(), loadChannels(), loadModels(),
      loadPrices(), loadTools(), loadHeatmap(), loadLatency(),
      loadProjects(), loadBudget(), loadSessions(), loadErrors(), loadToolUsage()
    ]);
  } catch (e) {
    console.error('数据加载失败:', e.message);
  } finally {
    loading.value = false;
  }
}

function setDays(d) {
  days.value = d;
  refreshAll();
}
function setGranularity(g) {
  granularity.value = g;
  loadTrend();
}
function setTrendChannel(c) {
  trendChannel.value = c;
  loadTrend();
}
function setUsagePage(p) {
  usage.page = p;
  loadUsage();
}
function setUsageFilter(f) {
  Object.assign(usageFilter, f);
  usage.page = 1;
  loadUsage();
}

/* ---- 预算告警：横幅文案 + 桌面通知（每等级每天最多提醒一次） ---- */
const budgetBannerText = computed(() => {
  const b = budget.value;
  if (!b || !b.level || b.level === 'none') return '';
  const parts = [];
  if (b.daily > 0 && b.daily_ratio >= 80) {
    parts.push(`今日费用 ${fmtCost(b.today_cost)} 已达日预算 ${fmtCost(b.daily)} 的 ${Math.round(b.daily_ratio)}%`);
  }
  if (b.monthly > 0 && b.monthly_ratio >= 80) {
    parts.push(`本月费用 ${fmtCost(b.month_cost)} 已达月预算 ${fmtCost(b.monthly)} 的 ${Math.round(b.monthly_ratio)}%`);
  }
  return parts.join('；');
});

function maybeNotifyBudget() {
  const b = budget.value;
  if (!b || !b.enabled || !b.level || b.level === 'none') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `tokenview-notified-${b.level}-${day}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch { /* localStorage 不可用时不做节流 */ }
  const title = b.level === 'danger' ? 'TokenView 预算告警' : 'TokenView 预算提醒';
  const body = budgetBannerText.value || '费用接近预算';
  try { new Notification(title, { body, silent: b.level !== 'danger' }); } catch { /* 通知失败静默 */ }
}

onMounted(() => {
  refreshAll();
  loadUsage();
  loadChannelList();
  restartTimer();
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.refresh-btn {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-main);
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, color 0.15s;
}
.refresh-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 预算告警横幅：扁平左边线，无阴影无渐变 */
.budget-banner {
  margin: 10px 24px 0;
  padding: 8px 12px;
  border: 1px solid var(--card-border);
  border-left: 3px solid var(--amber);
  border-radius: var(--radius);
  background: var(--card-bg);
  font-size: 12.5px;
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.budget-banner.danger { border-left-color: var(--red); }
.budget-banner-btn {
  border: 1px solid var(--card-border);
  background: var(--bg-0);
  color: var(--text-sub);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.budget-banner-btn:hover { border-color: var(--accent); color: var(--accent); }

/* 热力图更宽，延迟面板相对窄 */
.hm-grid { grid-template-columns: 1.5fr 1fr; }
@media (max-width: 1400px) {
  .hm-grid { grid-template-columns: 1fr; }
}
</style>
