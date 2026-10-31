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

    <div v-if="loadError" role="alert" style="color:var(--red);font-size:12px;margin-bottom:8px;">加载失败：{{ loadError }}，请刷新重试。</div>
    <div v-if="summary" class="bill-summary">
      <div class="bill-sum-item">
        <div class="bill-sum-label">月 Tokens</div>
        <div class="bill-sum-value">{{ fmtTokens(summary.tokens) }}</div>
      </div>
      <div class="bill-sum-item">
        <div class="bill-sum-label">月费用（市场价估算）</div>
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

    <!-- 订阅渠道回本视图：市场价费用对包月渠道是等价价值而非现金支出 -->
    <div v-if="summary && summary.market_value != null" class="bill-sub">
      <div class="bill-sub-item">
        <div class="bill-sum-label">等价市场价值</div>
        <div class="bill-sub-value">{{ fmtCost(summary.market_value) }}</div>
      </div>
      <div class="bill-sub-item">
        <div class="bill-sum-label">实际支出（订阅费 + 按量部分）</div>
        <div class="bill-sub-value">{{ fmtCost(summary.actual_spend) }}</div>
      </div>
      <div class="bill-sub-item">
        <div class="bill-sum-label">订阅节省</div>
        <div class="bill-sub-value" :style="summary.subscription_saved >= 0 ? 'color:var(--green);' : 'color:var(--red);'">
          {{ summary.subscription_saved >= 0 ? '' : '-' }}{{ fmtCost(Math.abs(summary.subscription_saved)) }}
        </div>
      </div>
      <div class="bill-sub-note">{{ summary.subscription_note }}；可在「设置 - 订阅渠道」中维护标记。节省为负说明订阅费高于该渠道等价用量。</div>
    </div>

    <div class="bill-cols">
      <div class="table-wrap" style="max-height:220px;">
        <table class="usage-table">
          <thead><tr><th>渠道</th><th style="text-align:right;">Tokens</th><th style="text-align:right;">费用</th></tr></thead>
          <tbody>
            <tr v-for="c in byChannel" :key="'c' + c.name">
              <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;" :title="c.name">
                {{ c.name }}
                <span v-if="c.subscription" class="bill-sub-tag" :title="`订阅制渠道，月费 ${fmtCost(c.monthly_fee)}`">订阅</span>
              </td>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { fetchBill, fetchBillMonths } from '../api';
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';
import { downloadCsv } from '../utils/download';

const months = ref([]);
const month = ref('');
const bill = ref(null);
const exporting = ref(false);
const loadError = ref('');
let loadRequest = 0;

const summary = computed(() => (bill.value && bill.value.summary) || null);
const byChannel = computed(() => (bill.value && bill.value.by_channel) || []);
const byModel = computed(() => (bill.value && bill.value.by_model) || []);

async function loadMonths() {
  months.value = await fetchBillMonths();
  if (!months.value.includes(month.value)) month.value = months.value[0] || '';
}

async function loadBill() {
  const request = ++loadRequest;
  loadError.value = '';
  if (!month.value) { bill.value = null; return; }
  try {
    const result = await fetchBill(month.value);
    if (request === loadRequest) bill.value = result;
  } catch (e) {
    if (request === loadRequest) loadError.value = e.message || '请求失败';
  }
}

async function refresh() {
  try {
    await loadMonths();
    await loadBill();
  } catch (e) {
    loadError.value = e.message || '请求失败';
  }
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

onMounted(refresh);
onBeforeUnmount(() => { loadRequest++; });
defineExpose({ loadMonths, refresh });
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
.bill-sub {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  gap: 8px 20px;
  align-items: center;
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 10px;
  margin-bottom: 12px;
}
.bill-sub-value {
  font-size: 14px;
  font-weight: 600;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bill-sub-note { font-size: 10.5px; color: var(--text-faint); }
.bill-sub-tag {
  margin-left: 6px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--card-border);
  border-radius: 3px;
  padding: 0 4px;
  cursor: help;
  vertical-align: 1px;
}
@media (max-width: 1100px) {
  .bill-cols { grid-template-columns: 1fr; }
}
</style>
