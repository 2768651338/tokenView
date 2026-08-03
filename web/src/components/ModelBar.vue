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
      backgroundColor: 'rgba(13, 20, 38, 0.95)',
      borderColor: 'rgba(94, 130, 255, 0.35)',
      textStyle: { color: '#e8edf9', fontSize: 12 },
      formatter: (ps) => {
        const idx = ps[0].dataIndex;
        const m = list[idx];
        return `<b>${m.model}</b><br/>渠道：${m.channel}<br/>Tokens：${fmtTokens(m.tokens)}<br/>费用：${fmtCost(m.cost)}<br/>调用：${m.calls.toLocaleString('zh-CN')} 次<br/><span style="color:#8b96ad;">市场价：输入 ¥${m.input_per_million}/百万 · 输出 ¥${m.output_per_million}/百万</span>`;
      }
    },
    grid: { left: 12, right: 30, top: 10, bottom: 6, containLabel: true },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(94, 130, 255, 0.09)' } },
      axisLabel: {
        color: '#8b96ad', fontSize: 11,
        formatter: (v) => (v >= 1e6 ? v / 1e6 + 'M' : v >= 1e3 ? v / 1e3 + 'K' : v)
      }
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#8b96ad', fontSize: 11, width: 100, overflow: 'truncate' }
    },
    series: [{
      type: 'bar',
      data: tokens,
      barWidth: 12,
      showBackground: true,
      backgroundStyle: { color: 'rgba(94, 130, 255, 0.07)', borderRadius: 6 },
      itemStyle: {
        borderRadius: 6,
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#22d3ee' },
          { offset: 1, color: '#8b5cf6' }
        ]),
        shadowBlur: 10,
        shadowColor: 'rgba(139, 92, 246, 0.4)'
      },
      label: {
        show: true,
        position: 'right',
        color: '#e8edf9',
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
