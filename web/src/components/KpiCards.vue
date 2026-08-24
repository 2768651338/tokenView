<template>
  <div class="kpi-grid">
    <div
      v-for="k in cards"
      :key="k.key"
      class="kpi-card"
    >
      <div class="kpi-label">{{ k.label }}</div>
      <div class="kpi-value">{{ k.value }}</div>
      <div class="kpi-sub">
        {{ k.sub }}
        <span
          v-if="k.delta !== null && k.delta !== undefined"
          class="kpi-delta"
          :class="deltaClass(k.delta)"
        >
          {{ deltaText(k.delta) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { fmtTokens, fmtCost, fmtNum, fmtPercent } from '../utils/format';

const props = defineProps({
  overview: { type: Object, default: () => ({}) }
});

function deltaClass(d) {
  if (d === null || d === undefined) return 'flat';
  return d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
}
function deltaText(d) {
  if (d === null || d === undefined) return '';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}% 较昨日`;
}

const cards = computed(() => {
  const o = props.overview || {};
  return [
    {
      key: 'total', label: '累计 Token 消耗', value: fmtTokens(o.total_tokens),
      sub: `近 ${o.range_days || 30} 天 ${fmtTokens(o.period_tokens)}`
    },
    {
      key: 'today', label: '今日消耗', value: fmtTokens(o.today_tokens),
      sub: `${fmtNum(o.today_calls)} 次调用`, delta: o.today_delta
    },
    {
      key: 'cost', label: '累计费用', value: fmtCost(o.total_cost),
      sub: `按市场价估算 · 近 ${o.range_days || 30} 天 ${fmtCost(o.period_cost)}`
    },
    {
      key: 'calls', label: '调用总次数', value: fmtNum(o.total_calls),
      sub: `日均 ${fmtNum(Math.round(o.avg_daily_tokens || 0))} tokens`
    },
    {
      key: 'channels', label: '活跃渠道', value: fmtNum(o.active_channels),
      sub: '接入 LLM 服务渠道'
    },
    {
      key: 'rate', label: '调用成功率', value: fmtPercent(o.success_rate),
      sub: '成功调用 / 总调用'
    }
  ];
});
</script>
