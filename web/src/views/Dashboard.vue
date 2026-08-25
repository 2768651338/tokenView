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
          >近 {{ d }} 天</button>
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
      </div>
    </header>

    <!-- KPI 卡片 -->
    <KpiCards :overview="overview" />

    <!-- 趋势 + 占比 -->
    <div class="main-grid">
      <TrendChart :trend="trend" :granularity="granularity" @granularity-change="setGranularity" />
      <ChannelPie :channels="channels" />
    </div>

    <!-- 排行 + 模型 Top -->
    <div class="lower-grid">
      <TopRank :channels="channels" />
      <ModelBar :models="models" />
    </div>

    <!-- 工具统计 + 模型市场价参考（两列紧凑并排） -->
    <div class="lower-grid">
      <ToolStats :tools="tools" />
      <PriceTable :data="prices" />
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
import {
  fetchOverview, fetchTrend, fetchChannels, fetchModels,
  fetchUsage, fetchChannelList, fetchPrices, fetchTools
} from '../api';

const dayOptions = [7, 30, 90];
const days = ref(7);
const granularity = ref('day');
const loading = ref(false);

const overview = ref({});
const trend = ref({ list: [] });
const channels = ref([]);
const models = ref([]);
const prices = ref({ list: [] });
const tools = ref([]);
const channelList = ref([]);

const usage = reactive({ list: [], total: 0, page: 1, pageSize: 20 });
const usageFilter = reactive({ channel: '', source: '', status: '', start: '', end: '' });

// 来源筛选选项（14 工具 + api）
const sourceOptions = [
  { id: 'zcode', name: 'ZCode' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN' },
  { id: 'joyclaw', name: 'JoyClaw' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'lobsterai', name: 'LobsterAI' },
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
  trend.value = await fetchTrend({ days: days.value, granularity: granularity.value });
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
    await Promise.all([loadOverview(), loadTrend(), loadChannels(), loadModels(), loadPrices(), loadTools()]);
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
function setUsagePage(p) {
  usage.page = p;
  loadUsage();
}
function setUsageFilter(f) {
  Object.assign(usageFilter, f);
  usage.page = 1;
  loadUsage();
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
</style>
