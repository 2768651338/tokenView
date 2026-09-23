<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>时段热力图</span>
      <div class="seg">
        <button :class="{ active: metric === 'tokens' }" @click="metric = 'tokens'">Tokens</button>
        <button :class="{ active: metric === 'calls' }" @click="metric = 'calls'">调用</button>
      </div>
    </div>
    <div class="hm-scroll">
      <div class="hm-table">
        <div class="hm-grid hm-head-row">
          <div class="hm-corner"></div>
          <div v-for="h in 24" :key="'h' + h" class="hm-col-label">{{ h - 1 }}</div>
        </div>
        <div v-for="(row, ri) in rows" :key="'r' + ri" class="hm-grid">
          <div class="hm-row-label">{{ dowNames[ri] }}</div>
          <div
            v-for="(cell, ci) in row"
            :key="ri + '-' + ci"
            class="hm-cell"
            :style="{ background: cellColor(cell) }"
            :title="cellTitle(ri, ci, cell)"
          ></div>
        </div>
      </div>
    </div>
    <div class="hm-legend">
      <span>少</span>
      <span class="hm-swatch" style="background:rgba(47,129,247,0.08);"></span>
      <span class="hm-swatch" style="background:rgba(47,129,247,0.3);"></span>
      <span class="hm-swatch" style="background:rgba(47,129,247,0.55);"></span>
      <span class="hm-swatch" style="background:rgba(47,129,247,0.8);"></span>
      <span>多</span>
      <span style="margin-left:auto;color:var(--text-faint);">本地时间 · {{ rangeText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { fmtTokens, fmtNum } from '../utils/format';

const props = defineProps({
  data: { type: Object, default: () => ({ list: [], max_tokens: 0, max_calls: 0 }) },
  days: { type: [Number, String], default: 30 }
});

const metric = ref('tokens');
const dowNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const rows = computed(() => {
  const list = props.data.list || [];
  const out = [];
  for (let d = 0; d < 7; d++) {
    out.push(list.slice(d * 24, d * 24 + 24));
  }
  return out;
});

const maxValue = computed(() => Math.max(1, Number(metric.value === 'tokens' ? props.data.max_tokens : props.data.max_calls) || 0));

const rangeText = computed(() => (props.days === 'all' ? '全部数据' : `近 ${props.days} 天`));

function cellColor(cell) {
  const v = Number(metric.value === 'tokens' ? cell.tokens : cell.calls) || 0;
  if (!v) return 'rgba(110, 118, 129, 0.08)';
  const alpha = 0.08 + 0.72 * Math.sqrt(v / maxValue.value);
  return `rgba(47, 129, 247, ${alpha.toFixed(3)})`;
}

function cellTitle(dow, hour, cell) {
  const v = metric.value === 'tokens' ? cell.tokens : cell.calls;
  const unit = metric.value === 'tokens' ? fmtTokens(cell.tokens) : `${fmtNum(cell.calls)} 次`;
  return `${dowNames[dow]} ${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59 · ${unit}（当前指标 ${fmtNum(v)}）`;
}
</script>

<style scoped>
.hm-scroll { overflow-x: auto; }
.hm-table { min-width: 520px; }
.hm-grid {
  display: grid;
  grid-template-columns: 34px repeat(24, minmax(16px, 1fr));
  gap: 2px;
}
.hm-corner { }
.hm-col-label {
  font-size: 9px;
  color: var(--text-faint);
  text-align: center;
  padding-bottom: 2px;
}
.hm-row-label {
  font-size: 10px;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.hm-cell {
  aspect-ratio: 1 / 1;
  border-radius: 2px;
  min-height: 14px;
  cursor: default;
}
.hm-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  font-size: 10px;
  color: var(--text-faint);
}
.hm-swatch {
  width: 12px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}
</style>
