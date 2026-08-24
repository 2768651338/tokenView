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
  '#2f81f7', '#39c5cf', '#3fb950', '#d29922',
  '#f85149', '#bc8cff', '#539bf5', '#ff9b57',
  '#8b949e', '#6cb0ff'
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
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      textStyle: { color: '#e6edf3', fontSize: 12 },
      formatter: (p) =>
        `<b>${p.name}</b><br/>Tokens：${fmtTokens(p.value)}（${p.ratio}%）<br/>费用：${fmtCost(p.cost)}<br/>调用：${p.calls.toLocaleString('zh-CN')} 次`
    },
    legend: {
      orient: 'vertical',
      right: 6,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      icon: 'rect',
      textStyle: { color: '#9198a1', fontSize: 11 },
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
      textStyle: { color: '#e6edf3', fontSize: 20, fontWeight: 600 },
      subtextStyle: { color: '#6e7681', fontSize: 11 }
    },
    series: [{
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['32%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderColor: '#161b22',
        borderWidth: 2
      },
      label: { show: false },
      emphasis: {
        scaleSize: 5,
        label: { show: false }
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
