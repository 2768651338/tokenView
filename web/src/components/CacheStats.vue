<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>缓存命中率</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        缓存读 /（纯输入 + 缓存读）· 近 {{ days === 'all' ? '全部' : days + ' 天' }}
      </span>
    </div>

    <div v-if="loadError" role="alert" style="color:var(--red);font-size:12px;margin-bottom:8px;">加载失败：{{ loadError }}，请刷新重试。</div>
    <div class="cs-overall">
      <div class="cs-rate">
        <div class="cs-rate-value" :style="rateColor">{{ overall ? overall.hit_rate : '—' }}<span class="cs-rate-unit">%</span></div>
        <div class="cs-rate-label">整体命中率</div>
      </div>
      <div class="cs-tokens">
        <div class="cs-token-row"><span>缓存读</span><b>{{ fmtTokens(overall ? overall.cache_read_tokens : 0) }}</b></div>
        <div class="cs-token-row"><span>纯输入</span><b>{{ fmtTokens(overall ? overall.input_tokens : 0) }}</b></div>
        <div class="cs-token-row"><span>缓存写</span><b>{{ fmtTokens(overall ? overall.cache_write_tokens : 0) }}</b></div>
      </div>
      <div ref="chartRef" class="cs-chart"></div>
    </div>

    <div class="table-wrap" style="max-height:150px;">
      <table class="usage-table">
        <thead>
          <tr>
            <th>渠道</th>
            <th style="text-align:right;">命中率</th>
            <th style="text-align:right;">缓存读</th>
            <th style="text-align:right;">纯输入</th>
            <th style="text-align:right;">调用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in channels" :key="c.channel">
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;" :title="c.channel">{{ c.channel }}</td>
            <td style="text-align:right;font-weight:600;">{{ c.hit_rate == null ? '—' : c.hit_rate + '%' }}</td>
            <td style="text-align:right;">{{ fmtTokens(c.cache_read_tokens) }}</td>
            <td style="text-align:right;color:var(--text-sub);">{{ fmtTokens(c.input_tokens) }}</td>
            <td style="text-align:right;color:var(--text-sub);">{{ fmtNum(c.calls) }}</td>
          </tr>
          <tr v-if="!channels.length">
            <td colspan="5" style="text-align:center;color:var(--text-faint);padding:16px;">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="cs-note">命中率低通常意味着每轮 prompt 变化过大（缓存写多读少）；仅统计携带缓存字段的渠道。</div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { fetchCacheStats } from '../api';
import { fmtNum, fmtTokens } from '../utils/format';

const props = defineProps({
  days: { type: [Number, String], default: 30 }
});

const data = ref(null);
const loadError = ref('');
let loadRequest = 0;
const chartRef = ref(null);
let chart = null;

const overall = computed(() => (data.value && data.value.overall) || null);
const channels = computed(() => (data.value && data.value.channels) || []);

const rateColor = computed(() => {
  const v = overall.value && overall.value.hit_rate;
  if (v == null) return '';
  return { color: v >= 80 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)' };
});

function render() {
  if (!chart || !data.value) return;
  const list = data.value.list || [];
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      textStyle: { color: '#e6edf3', fontSize: 11 },
      valueFormatter: (v) => (v == null ? '—' : v + '%')
    },
    xAxis: {
      type: 'category',
      data: list.map((d) => d.label),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#30363d' } },
      axisLabel: { color: '#9198a1', fontSize: 10, interval: 'auto' },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      max: 100,
      splitLine: { lineStyle: { color: '#21262d' } },
      axisLabel: { color: '#9198a1', fontSize: 10, formatter: '{value}%' }
    },
    series: [{
      type: 'line',
      data: list.map((d) => d.hit_rate),
      smooth: 0.3,
      symbol: 'none',
      lineStyle: { width: 1.5, color: '#39c5cf' },
      areaStyle: { color: '#39c5cf1a' },
      connectNulls: false
    }]
  }, true);
}

function resize() { chart && chart.resize(); }

async function load() {
  const request = ++loadRequest;
  loadError.value = '';
  try {
    const result = await fetchCacheStats(props.days);
    if (request !== loadRequest) return;
    data.value = result;
    render();
  } catch (e) {
    if (request === loadRequest) loadError.value = e.message || '请求失败';
  }
}
defineExpose({ refresh: load });

onMounted(() => {
  chart = echarts.init(chartRef.value);
  window.addEventListener('resize', resize);
  load();
});
onBeforeUnmount(() => {
  loadRequest++;
  window.removeEventListener('resize', resize);
  chart && chart.dispose();
});
watch(() => props.days, load);
</script>

<style scoped>
.cs-overall {
  display: grid;
  grid-template-columns: auto 1fr 1.4fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.cs-rate-value {
  font-size: 26px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.cs-rate-unit { font-size: 13px; font-weight: 400; color: var(--text-sub); margin-left: 1px; }
.cs-rate-label { font-size: 10px; color: var(--text-faint); }
.cs-tokens { display: flex; flex-direction: column; gap: 3px; }
.cs-token-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
}
.cs-token-row b { color: var(--text-main); font-weight: 600; }
.cs-chart { height: 88px; min-width: 0; }
.cs-note { font-size: 10.5px; color: var(--text-faint); margin-top: 6px; }
@media (max-width: 1100px) {
  .cs-overall { grid-template-columns: 1fr 1fr; }
  .cs-chart { grid-column: 1 / -1; }
}
</style>
