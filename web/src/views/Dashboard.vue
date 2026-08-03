<template>
  <div>
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo">⚡</div>
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

    <!-- 模型市场价参考 -->
    <div style="padding: 0 28px 14px;">
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
        @page-change="setUsagePage"
        @filter-change="setUsageFilter"
        @refresh="loadUsage"
      />
    </div>

    <footer style="text-align:center;color:var(--text-faint);font-size:11px;padding-bottom:20px;">
      TokenView · 真实数据实时直读 ZCode 与 Claude Code，无数据库依赖 · 每 60 秒自动刷新
    </footer>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import KpiCards from '../components/KpiCards.vue';
import TrendChart from '../components/TrendChart.vue';
import ChannelPie from '../components/ChannelPie.vue';
import ModelBar from '../components/ModelBar.vue';
import TopRank from '../components/TopRank.vue';
import PriceTable from '../components/PriceTable.vue';
import UsageTable from '../components/UsageTable.vue';
import {
  fetchOverview, fetchTrend, fetchChannels, fetchModels,
  fetchUsage, fetchChannelList, fetchPrices
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
const channelList = ref([]);

const usage = reactive({ list: [], total: 0, page: 1, pageSize: 20 });
const usageFilter = reactive({ channel: '', status: '', start: '', end: '' });

let timer = null;

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
    await Promise.all([loadOverview(), loadTrend(), loadChannels(), loadModels(), loadPrices()]);
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
  timer = setInterval(() => {
    // 明细表不参与自动刷新，避免打断翻页
    refreshAll();
  }, 60000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.refresh-btn {
  border: 1px solid rgba(34, 211, 238, 0.35);
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.15), rgba(139, 92, 246, 0.15));
  color: #9be9ff;
  border-radius: 10px;
  padding: 7px 18px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
}
.refresh-btn:hover:not(:disabled) {
  border-color: var(--accent);
  box-shadow: 0 0 14px rgba(34, 211, 238, 0.35);
}
.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
