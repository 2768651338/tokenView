<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span>消耗趋势</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select class="trend-channel" :value="channel" title="按渠道筛选" @change="$emit('channel-change', $event.target.value)">
          <option value="">全部渠道</option>
          <option v-for="c in channelList" :key="c.id" :value="c.name">{{ c.name }}</option>
        </select>
        <div class="seg">
          <button
            v-for="g in granularities" :key="g.value"
            :class="{ active: granularity === g.value }"
            @click="$emit('granularity-change', g.value)"
          >{{ g.label }}</button>
        </div>
        <div class="seg">
          <button
            v-for="m in metrics" :key="m.value"
            :class="{ active: metric === m.value }"
            @click="metric = m.value"
          >{{ m.label }}</button>
        </div>
      </div>
    </div>
    <div ref="chartRef" class="chart-box"></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';

const props = defineProps({
  trend: { type: Object, default: () => ({ list: [] }) },
  granularity: { type: String, default: 'day' },
  channel: { type: String, default: '' },
  channelList: { type: Array, default: () => [] }
});
defineEmits(['granularity-change', 'channel-change']);

const granularities = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' }
];
const metrics = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: '费用' },
  { value: 'calls', label: '调用' }
];

const metric = ref('tokens');
const chartRef = ref(null);
let chart = null;

/** GitHub Dark 扁平配色：输入蓝 / 缓存青 / 输出绿 / 上期灰 */
const COLORS = {
  prompt: '#2f81f7',
  cache: '#39c5cf',
  completion: '#3fb950',
  cost: '#d29922',
  calls: '#3fb950',
  prev: '#9198a1'
};

/** 单值指标（费用/调用）的当前期与上期两条线 */
function singleSeries(list, key, color, name) {
  return {
    name,
    type: 'line',
    data: list.map((d) => Number(d[key]) || 0),
    smooth: 0.3,
    symbol: 'circle',
    symbolSize: 4,
    showSymbol: false,
    lineStyle: { width: 2, color },
    itemStyle: { color, borderColor: '#161b22', borderWidth: 2 },
    areaStyle: { color: color + '1a' },
    markLine: {
      silent: true,
      symbol: 'none',
      lineStyle: { color: '#6e7681', type: 'dashed' },
      label: { color: '#6e7681', fontSize: 10 },
      data: [{
        type: 'average',
        label: { formatter: ({ value }) => '日均 ' + fmtVal(key, value), color: '#9198a1' }
      }]
    }
  };
}

function fmtVal(key, v) {
  if (key === 'cost') return fmtCost(v);
  if (key === 'calls') return fmtNum(v);
  return fmtTokens(v);
}

function render() {
  if (!chart) return;
  const list = props.trend.list || [];
  const prev = props.trend.prev_list || null;
  const labels = list.map((d) => d.label);
  // 上期序列与当前期按下标对齐（week/month 桶数可能略少，缺失置 null 断线）
  const prevVals = prev ? list.map((_, i) => {
    const p = prev[i];
    return p ? Number(p[metric.value === 'tokens' ? 'tokens' : metric.value]) || 0 : null;
  }) : [];
  const hasPrev = !!(prev && prevVals.some((v) => v !== null && v > 0));

  let series;
  let legend;
  if (metric.value === 'tokens') {
    // 输入 / 缓存 / 输出 堆叠面积
    const stackOf = (key) => list.map((d) => Number(d[key]) || 0);
    const defs = [
      { key: 'prompt_tokens', name: '输入', color: COLORS.prompt },
      { key: 'cache_tokens', name: '缓存', color: COLORS.cache },
      { key: 'completion_tokens', name: '输出', color: COLORS.completion }
    ];
    series = defs.map((d) => ({
      name: d.name,
      type: 'line',
      stack: 'tokens',
      data: stackOf(d.key),
      smooth: 0.3,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: false,
      lineStyle: { width: 1, color: d.color },
      itemStyle: { color: d.color },
      areaStyle: { color: d.color + '33' }
    }));
    if (hasPrev) {
      series.push({
        name: '上期',
        type: 'line',
        data: prevVals,
        smooth: 0.3,
        symbol: 'none',
        lineStyle: { width: 1.5, color: COLORS.prev, type: 'dashed' },
        itemStyle: { color: COLORS.prev }
      });
    }
    legend = { show: true, top: 2, left: 4, icon: 'roundRect', itemWidth: 10, itemHeight: 6, textStyle: { color: '#9198a1', fontSize: 11 } };
  } else {
    series = [singleSeries(list, metric.value, COLORS[metric.value], metrics.find((m) => m.value === metric.value).label)];
    if (hasPrev) {
      series.push({
        name: '上期',
        type: 'line',
        data: prevVals,
        smooth: 0.3,
        symbol: 'none',
        lineStyle: { width: 1.5, color: COLORS.prev, type: 'dashed' },
        itemStyle: { color: COLORS.prev }
      });
    }
    legend = { show: hasPrev, top: 2, left: 4, icon: 'roundRect', itemWidth: 10, itemHeight: 6, textStyle: { color: '#9198a1', fontSize: 11 } };
  }

  const fmt = (v) => fmtVal(metric.value, v);

  chart.setOption({
    backgroundColor: 'transparent',
    legend,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      textStyle: { color: '#e6edf3', fontSize: 12 },
      formatter: (params) => {
        if (!params || !params.length) return '';
        const lines = [params[0].axisValue];
        let total = 0;
        for (const p of params) {
          if (p.value === null || p.value === undefined) continue;
          lines.push(`${p.marker}${p.seriesName}  ${fmt(p.value)}`);
          if (p.seriesName !== '上期') total += Number(p.value) || 0;
        }
        if (params.length > 1) lines.push(`合计  ${fmt(total)}`);
        return lines.join('<br/>');
      }
    },
    grid: { left: 12, right: 16, top: 36, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#30363d' } },
      axisLabel: { color: '#9198a1', fontSize: 11, interval: 'auto' },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#21262d' } },
      axisLabel: {
        color: '#9198a1', fontSize: 11,
        formatter: (v) => {
          if (metric.value === 'cost') return '¥' + v;
          return v >= 1e6 ? v / 1e6 + 'M' : v >= 1e3 ? v / 1e3 + 'K' : v;
        }
      }
    },
    series
  }, true);
}

function resize() { chart && chart.resize(); }

onMounted(() => {
  chart = echarts.init(chartRef.value);
  render();
  window.addEventListener('resize', resize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart && chart.dispose();
});
watch(() => [props.trend, props.granularity, props.channel, metric.value], render, { deep: true });
</script>

<style scoped>
.trend-channel {
  background: var(--bg-0);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
  cursor: pointer;
  max-width: 150px;
}
.trend-channel:hover { border-color: var(--accent); }
.trend-channel option { background: var(--bg-0); }
</style>
