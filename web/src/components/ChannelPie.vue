<template>
  <div class="panel">
    <div class="panel-title">渠道消耗占比</div>
    <div ref="chartRef" class="chart-box"></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';
import { fmtTokens, fmtCost } from '../utils/format';

const props = defineProps({
  channels: { type: Array, default: () => [] }
});

const chartRef = ref(null);
let chart = null;

const PALETTE = [
  '#22d3ee', '#8b5cf6', '#34d399', '#fbbf24',
  '#f87171', '#60a5fa', '#f472b6', '#2dd4bf',
  '#a3e635', '#fb923c'
];

function render() {
  if (!chart) return;
  const data = (props.channels || []).map((c, i) => ({
    name: c.name,
    value: c.tokens,
    ratio: c.ratio,
    cost: c.cost,
    calls: c.calls,
    itemStyle: { color: PALETTE[i % PALETTE.length] }
  }));
  const total = data.reduce((s, d) => s + d.value, 0);

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(13, 20, 38, 0.95)',
      borderColor: 'rgba(94, 130, 255, 0.35)',
      textStyle: { color: '#e8edf9', fontSize: 12 },
      formatter: (p) =>
        `<b>${p.name}</b><br/>Tokens：${fmtTokens(p.value)}（${p.ratio}%）<br/>费用：${fmtCost(p.cost)}<br/>调用：${p.calls.toLocaleString('zh-CN')} 次`
    },
    legend: {
      orient: 'vertical',
      right: 6,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: '#8b96ad', fontSize: 11 },
      formatter: (name) => {
        const d = data.find((x) => x.name === name);
        return `${name}  ${d ? d.ratio + '%' : ''}`;
      }
    },
    title: {
      text: fmtTokens(total),
      subtext: '总 Tokens',
      left: '30%',
      top: '38%',
      textAlign: 'center',
      textStyle: { color: '#e8edf9', fontSize: 20, fontWeight: 700 },
      subtextStyle: { color: '#56617a', fontSize: 11 }
    },
    series: [{
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['32%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderColor: '#0b1120',
        borderWidth: 2,
        shadowBlur: 10,
        shadowColor: 'rgba(34, 211, 238, 0.25)'
      },
      label: { show: false },
      emphasis: {
        scaleSize: 6,
        label: { show: false },
        itemStyle: { shadowBlur: 22, shadowColor: 'rgba(34, 211, 238, 0.5)' }
      },
      data
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
watch(() => props.channels, render, { deep: true });
</script>
