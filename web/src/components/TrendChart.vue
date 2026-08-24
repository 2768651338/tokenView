<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;">
      <span>消耗趋势</span>
      <div style="display:flex;gap:8px;">
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
  granularity: { type: String, default: 'day' }
});
defineEmits(['granularity-change']);

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

const COLORS = {
  tokens: '#2f81f7',
  cost: '#d29922',
  calls: '#3fb950'
};

function render() {
  if (!chart) return;
  const list = props.trend.list || [];
  const labels = list.map((d) => d.label);
  const values = list.map((d) => Number(d[metric.value]) || 0);
  const c1 = COLORS[metric.value];
  const fmt = metric.value === 'cost' ? fmtCost : metric.value === 'calls' ? fmtNum : fmtTokens;

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      textStyle: { color: '#e6edf3', fontSize: 12 },
      valueFormatter: (v) => fmt(v)
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
    series: [{
      name: metrics.find((m) => m.value === metric.value).label,
      type: 'line',
      data: values,
      smooth: 0.3,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: false,
      lineStyle: { width: 2, color: c1 },
      itemStyle: { color: c1, borderColor: '#161b22', borderWidth: 2 },
      areaStyle: { color: c1 + '1a' },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#6e7681', type: 'dashed' },
        label: { color: '#6e7681', fontSize: 10, formatter: '均值' },
        data: [{
          type: 'average',
          label: { formatter: ({ value }) => '日均 ' + fmt(value), color: '#9198a1' }
        }]
      }
    }]
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
watch(() => [props.trend, props.granularity, metric.value], render, { deep: true });
</script>
