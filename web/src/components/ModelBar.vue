<template>
  <div class="panel">
    <div class="panel-title">模型消耗 Top {{ models.length }}</div>
    <div ref="chartRef" class="chart-box tall"></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';
import { fmtTokens, fmtCost } from '../utils/format';

const props = defineProps({
  models: { type: Array, default: () => [] }
});

const chartRef = ref(null);
let chart = null;

function render() {
  if (!chart) return;
  const list = (props.models || []).slice().reverse(); // 倒序使 Top1 在顶部
  const names = list.map((m) => m.model);
  const tokens = list.map((m) => Number(m.tokens));

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      textStyle: { color: '#e6edf3', fontSize: 12 },
      formatter: (ps) => {
        const idx = ps[0].dataIndex;
        const m = list[idx];
        return `<b>${m.model}</b><br/>渠道：${m.channel}<br/>Tokens：${fmtTokens(m.tokens)}<br/>费用：${fmtCost(m.cost)}<br/>调用：${m.calls.toLocaleString('zh-CN')} 次<br/><span style="color:#9198a1;">市场价：输入 ¥${m.input_per_million}/百万 · 输出 ¥${m.output_per_million}/百万</span>`;
      }
    },
    grid: { left: 12, right: 30, top: 10, bottom: 6, containLabel: true },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#21262d' } },
      axisLabel: {
        color: '#9198a1', fontSize: 11,
        formatter: (v) => (v >= 1e6 ? v / 1e6 + 'M' : v >= 1e3 ? v / 1e3 + 'K' : v)
      }
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#9198a1', fontSize: 11, width: 100, overflow: 'truncate' }
    },
    series: [{
      type: 'bar',
      data: tokens,
      barWidth: 10,
      showBackground: true,
      backgroundStyle: { color: '#21262d', borderRadius: 2 },
      itemStyle: {
        borderRadius: 2,
        color: '#2f81f7'
      },
      label: {
        show: true,
        position: 'right',
        color: '#e6edf3',
        fontSize: 11,
        formatter: (p) => fmtTokens(p.value)
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
watch(() => props.models, render, { deep: true });
</script>
