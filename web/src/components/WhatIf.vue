<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>What-if 成本模拟</span>
      <select v-model="targetModel" class="wif-select" title="假设全部调用都换成该模型">
        <option value="" disabled>选择模拟目标模型</option>
        <option v-for="m in models" :key="m.model" :value="m.model">{{ m.model }}</option>
      </select>
    </div>

    <div v-if="!data || !data.models || !data.models.length" class="wif-empty">
      所选范围内暂无数据
    </div>
    <template v-else>
      <div class="wif-cards">
        <div class="wif-card">
          <div class="wif-card-label">实际费用</div>
          <div class="wif-card-value">{{ fmtCost(data.actual_cost) }}</div>
        </div>
        <div class="wif-card" :class="{ dim: !data.simulated_cost }">
          <div class="wif-card-label">模拟：全用 {{ data.target ? data.target.model : '—' }}</div>
          <div class="wif-card-value" :style="deltaColor">{{ data.simulated_cost != null ? fmtCost(data.simulated_cost) : '—' }}</div>
        </div>
        <div class="wif-card" :class="{ dim: data.delta_cost == null }">
          <div class="wif-card-label">差额（模拟 - 实际）</div>
          <div class="wif-card-value" :style="deltaColor">{{ data.delta_cost != null ? fmtCost(data.delta_cost) : '—' }}</div>
        </div>
      </div>
      <div class="wif-note">
        <template v-if="data.note">{{ data.note }}</template>
        <template v-else>选择目标模型后，按其单价对范围内全部 tokens 重新计价</template>
        <template v-if="data.target"> · 目标价 输入 {{ data.target.input_per_million }} / 输出 {{ data.target.output_per_million }} 元每百万</template>
      </div>
      <div class="table-wrap" style="max-height:200px;">
        <table class="usage-table">
          <thead>
            <tr>
              <th>模型</th>
              <th style="text-align:right;">输入</th>
              <th style="text-align:right;">输出</th>
              <th style="text-align:right;">缓存读</th>
              <th style="text-align:right;">调用</th>
              <th style="text-align:right;">实际费用</th>
              <th style="text-align:right;">单价（入/出，元每百万）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in models" :key="m.model">
              <td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;" :title="m.model">{{ m.model }}</td>
              <td style="text-align:right;">{{ fmtTokens(m.prompt_tokens) }}</td>
              <td style="text-align:right;">{{ fmtTokens(m.completion_tokens) }}</td>
              <td style="text-align:right;color:var(--text-sub);">{{ fmtTokens(m.cache_read_tokens) }}</td>
              <td style="text-align:right;color:var(--text-sub);">{{ fmtNum(m.calls) }}</td>
              <td style="text-align:right;color:var(--amber);">{{ fmtCost(m.actual_cost) }}</td>
              <td style="text-align:right;color:var(--text-faint);">{{ m.input_per_million }} / {{ m.output_per_million }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { fetchWhatIf } from '../api';
import { fmtCost, fmtNum, fmtTokens } from '../utils/format';

const props = defineProps({
  days: { type: [Number, String], default: 30 }
});

const data = ref(null);
const targetModel = ref('');
const models = computed(() => (data.value && data.value.models) || []);

const deltaColor = computed(() => {
  const d = data.value && data.value.delta_cost;
  if (d == null) return '';
  return { color: d > 0 ? 'var(--red)' : d < 0 ? 'var(--green)' : 'var(--text-main)' };
});

async function load() {
  try {
    data.value = await fetchWhatIf(props.days, targetModel.value);
    // 当前选中的模型不在列表里时（切换时间范围）重置，避免悬挂无效选项
    if (targetModel.value && !models.value.some((m) => m.model === targetModel.value)) {
      targetModel.value = '';
    }
  } catch { /* 面板静默：下次刷新重试 */ }
}

watch(() => props.days, () => { targetModel.value = ''; load(); });
watch(targetModel, load);
load();
</script>

<style scoped>
.wif-select {
  background: var(--bg-0);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
  cursor: pointer;
  max-width: 200px;
}
.wif-select option { background: var(--bg-0); }
.wif-empty { text-align: center; color: var(--text-faint); padding: 32px 0; font-size: 12px; }
.wif-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
.wif-card {
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 10px;
}
.wif-card.dim .wif-card-value { color: var(--text-faint); }
.wif-card-label { font-size: 10px; color: var(--text-faint); }
.wif-card-value {
  font-size: 16px;
  font-weight: 600;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wif-note { font-size: 10.5px; color: var(--text-faint); margin-bottom: 8px; }
</style>
