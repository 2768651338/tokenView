<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>月度账单</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <select v-model="month" class="bill-month" title="选择月份" @change="loadBill">
          <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
        </select>
        <button class="bill-btn" :disabled="exporting || !bill" @click="exportBill">{{ exporting ? '导出中...' : '导出 CSV' }}</button>
      </div>
    </div>

    <div v-if="summary" class="bill-summary">
      <div class="bill-sum-item">
        <div class="bill-sum-label">月 Tokens</div>
        <div class="bill-sum-value">{{ fmtTokens(summary.tokens) }}</div>
      </div>
      <div class="bill-sum-item">
        <div class="bill-sum-label">月费用</div>
        <div class="bill-sum-value" style="color:var(--amber);">{{ fmtCost(summary.cost) }}</div>
      </div>
      <div class="bill-sum-item">
        <div class="bill-sum-label">调用次数</div>
        <div class="bill-sum-value">{{ fmtNum(summary.calls) }}</div>
      </div>
      <div class="bill-sum-item">
        <div class="bill-sum-label">活跃天数</div>
        <div class="bill-sum-value">{{ summary.active_days }}</div>
      </div>
    </div>

    <div class="bill-cols">
      <div class="table-wrap" style="max-height:220px;">
        <table class="usage-table">
          <thead><tr><th>渠道</th><th style="text-align:right;">Tokens</th><th style="text-align:right;">费用</th></tr></thead>
          <tbody>
            <tr v-for="c in byChannel" :key="'c' + c.name">
              <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;" :title="c.name">{{ c.name }}</td>
              <td style="text-align:right;">{{ fmtTokens(c.tokens) }}</td>
              <td style="text-align:right;color:var(--amber);">{{ fmtCost(c.cost) }}</td>
            </tr>
            <tr v-if="!byChannel.length"><td colspan="3" style="text-align:center;color:var(--text-faint);padding:16px;">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
      <div class="table-wrap" style="max-height:220px;">
        <table class="usage-table">
          <thead><tr><th>模型</th><th style="text-align:right;">Tokens</th><th style="text-align:right;">费用</th></tr></thead>
          <tbody>
            <tr v-for="m in byModel" :key="'m' + m.name">
              <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;" :title="m.name">{{ m.name }}</td>
              <td style="text-align:right;">{{ fmtTokens(m.tokens) }}</td>
              <td style="text-align:right;color:var(--amber);">{{ fmtCost(m.cost) }}</td>
            </tr>
            <tr v-if="!byModel.length"><td colspan="3" style="text-align:center;color:var(--text-faint);padding:16px;">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { fetchBill, fetchBillMonths } from '../api';
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';
import { downloadCsv } from '../utils/download';

const months = ref([]);
const month = ref('');
const bill = ref(null);
const exporting = ref(false);

const summary = computed(() => (bill.value && bill.value.summary) || null);
const byChannel = computed(() => (bill.value && bill.value.by_channel) || []);
const byModel = computed(() => (bill.value && bill.value.by_model) || []);

async function loadMonths() {
  months.value = await fetchBillMonths();
  if (months.value.length && !month.value) month.value = months.value[0];
}

async function loadBill() {
  if (!month.value) return;
  bill.value = await fetchBill(month.value);
}

async function exportBill() {
  if (!bill.value) return;
  exporting.value = true;
  try {
    const columns = [['dim', '维度'], ['name', '名称'], ['tokens', 'Tokens'], ['cost', '费用(元)'], ['calls', '调用']];
    const rows = [
      ...((bill.value.by_channel) || []).map((x) => ({ dim: '渠道', ...x })),
      ...((bill.value.by_model) || []).map((x) => ({ dim: '模型', ...x })),
      ...((bill.value.by_tool) || []).map((x) => ({ dim: '工具', ...x }))
    ];
    downloadCsv(`tokenview-bill-${bill.value.month}.csv`, columns, rows);
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  await loadMonths();
  await loadBill();
});
defineExpose({ loadMonths });
</script>

<style scoped>
.bill-month {
  background: var(--bg-0);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
  cursor: pointer;
}
.bill-month option { background: var(--bg-0); }
.bill-btn {
  border: 1px solid var(--card-border);
  background: var(--bg-0);
  color: var(--text-main);
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.bill-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.bill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.bill-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.bill-sum-item {
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 10px;
}
.bill-sum-label { font-size: 10px; color: var(--text-faint); }
.bill-sum-value {
  font-size: 15px;
  font-weight: 600;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.bill-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 1100px) {
  .bill-cols { grid-template-columns: 1fr; }
}
</style>
