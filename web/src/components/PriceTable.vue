<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>模型市场价参考</span>
      <span style="flex:1;font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;text-align:right;">
        {{ noteText }}
      </span>
      <button class="pt-add" :disabled="syncing" @click="syncOnline">{{ syncing ? '同步中...' : '⟳ 同步在线价格' }}</button>
      <button class="pt-add" @click="startAdd">＋ 新增模型</button>
    </div>
    <div v-if="syncError" class="pt-error" style="margin:-6px 0 8px;text-align:left;">同步失败：{{ syncError }}</div>
    <div class="table-wrap" style="max-height:340px;">
      <table class="usage-table">
        <thead>
          <tr>
            <th>模型</th>
            <th>渠道</th>
            <th style="text-align:right;">输入单价</th>
            <th style="text-align:right;">输出单价</th>
            <th style="text-align:right;">累计 Tokens</th>
            <th style="text-align:right;">累计费用</th>
            <th style="text-align:right;">调用次数</th>
            <th style="text-align:right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="editing && editing.isNew">
            <td><input v-model="editing.model" class="pt-input" style="width:120px;" placeholder="模型名称" @keyup.enter="saveEdit" /></td>
            <td style="color:var(--text-faint);">—</td>
            <td style="text-align:right;"><input v-model="editing.input" class="pt-input" style="width:76px;text-align:right;" type="number" min="0" step="any" placeholder="¥/百万" /></td>
            <td style="text-align:right;"><input v-model="editing.output" class="pt-input" style="width:76px;text-align:right;" type="number" min="0" step="any" placeholder="¥/百万" /></td>
            <td style="color:var(--text-faint);text-align:right;">—</td>
            <td style="color:var(--text-faint);text-align:right;">—</td>
            <td style="color:var(--text-faint);text-align:right;">—</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="pt-link" :disabled="saving" @click="saveEdit">保存</button>
              <button class="pt-link" :disabled="saving" @click="cancelEdit">取消</button>
              <div v-if="editing.error" class="pt-error">{{ editing.error }}</div>
            </td>
          </tr>
          <template v-for="p in list" :key="p.id">
            <tr v-if="isEditing(p.model)">
              <td style="font-weight:600;">
                {{ p.model }}
                <span v-if="p.custom" class="chip" style="margin-left:6px;font-size:10px;padding:0 6px;">自定义</span>
              </td>
              <td><span v-if="p.channel" class="chip">{{ p.channel }}</span><span v-else style="color:var(--text-faint);">—</span></td>
              <td style="text-align:right;"><input v-model="editing.input" class="pt-input" style="width:76px;text-align:right;" type="number" min="0" step="any" /></td>
              <td style="text-align:right;"><input v-model="editing.output" class="pt-input" style="width:76px;text-align:right;" type="number" min="0" step="any" /></td>
              <td style="text-align:right;">{{ fmtTokens(p.tokens) }}</td>
              <td style="text-align:right;">{{ fmtCost(p.cost) }}</td>
              <td style="text-align:right;">{{ fmtNum(p.calls) }}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="pt-link" :disabled="saving" @click="saveEdit">保存</button>
                <button class="pt-link" :disabled="saving" @click="cancelEdit">取消</button>
                <div v-if="editing.error" class="pt-error">{{ editing.error }}</div>
              </td>
            </tr>
            <tr v-else>
              <td style="font-weight:600;">
                {{ p.model }}
                <span v-if="p.custom" class="chip" style="margin-left:6px;font-size:10px;padding:0 6px;">自定义</span>
                <span v-else-if="p.source === 'modelradar'" class="chip" style="margin-left:6px;font-size:10px;padding:0 6px;">在线</span>
              </td>
              <td><span v-if="p.channel" class="chip">{{ p.channel }}</span><span v-else style="color:var(--text-faint);">—</span></td>
              <td style="text-align:right;color:var(--accent);">¥{{ p.input_per_million }}<span class="unit">/百万</span></td>
              <td style="text-align:right;color:var(--accent-2);">¥{{ p.output_per_million }}<span class="unit">/百万</span></td>
              <td style="text-align:right;">{{ fmtTokens(p.tokens) }}</td>
              <td style="text-align:right;color:var(--amber);font-weight:600;">{{ fmtCost(p.cost) }}</td>
              <td style="text-align:right;color:var(--text-sub);">{{ fmtNum(p.calls) }}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="pt-link" @click="startEdit(p)">编辑</button>
                <button v-if="p.custom" class="pt-link" @click="resetPrice(p)">恢复默认</button>
              </td>
            </tr>
          </template>
          <tr v-if="!list.length && !(editing && editing.isNew)">
            <td colspan="8" style="text-align:center;color:var(--text-faint);padding:24px;">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';
import { saveModelPrice, resetModelPrice, syncModelRadarPrices } from '../api';

const props = defineProps({
  data: { type: Object, default: () => ({ list: [], note: '', currency: '', online: null }) }
});
const emit = defineEmits(['refresh']);

const list = computed(() => props.data.list || []);
const meta = computed(() => props.data);

// 面板说明：三层价目 + 在线同步时间
const noteText = computed(() => {
  const parts = [meta.value.note || ''];
  const online = meta.value.online;
  if (online && online.syncedAt) {
    const t = new Date(online.syncedAt).toLocaleString('zh-CN', { hour12: false });
    parts.push(`在线价同步于 ${t}${online.effectiveDate ? '（生效日 ' + online.effectiveDate + '）' : ''}`);
  } else {
    parts.push('尚未同步在线价');
  }
  return parts.filter(Boolean).join(' · ');
});

// 同步在线价格（ModelRadar）
const syncing = ref(false);
const syncError = ref('');
async function syncOnline() {
  if (syncing.value) return;
  syncing.value = true;
  syncError.value = '';
  try {
    await syncModelRadarPrices();
    emit('refresh');
  } catch (err) {
    syncError.value = err.message;
  } finally {
    syncing.value = false;
  }
}

// 编辑态：{ model, input, output, isNew, error }，单价以「元 / 百万」呈现，保存时换算为元 / 1K
const editing = ref(null);
const saving = ref(false);

function isEditing(model) {
  return !!editing.value && !editing.value.isNew && editing.value.model === model;
}
function startEdit(row) {
  editing.value = { model: row.model, input: String(row.input_per_million), output: String(row.output_per_million), isNew: false, error: '' };
}
function startAdd() {
  editing.value = { model: '', input: '', output: '', isNew: true, error: '' };
}
function cancelEdit() {
  editing.value = null;
}
function validate(e) {
  if (e.isNew && !e.model.trim()) { e.error = '模型名不能为空'; return false; }
  const i = Number(e.input);
  const o = Number(e.output);
  if (e.input === '' || e.output === '' || !Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) {
    e.error = '单价必须为不小于 0 的数字';
    return false;
  }
  e.error = '';
  return true;
}
async function saveEdit() {
  const e = editing.value;
  if (!e || saving.value || !validate(e)) return;
  saving.value = true;
  try {
    // 展示单位为元/百万，存储单位为元/1K
    await saveModelPrice(e.model.trim(), Number(e.input) / 1000, Number(e.output) / 1000);
    editing.value = null;
    emit('refresh');
  } catch (err) {
    e.error = err.message;
  } finally {
    saving.value = false;
  }
}
async function resetPrice(row) {
  if (saving.value) return;
  saving.value = true;
  try {
    await resetModelPrice(row.model);
    emit('refresh');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.unit { font-size: 10px; color: var(--text-faint); margin-left: 2px; }
.pt-link {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  font-family: inherit;
}
.pt-link:hover { text-decoration: underline; }
.pt-link:disabled { color: var(--text-faint); cursor: not-allowed; text-decoration: none; }
.pt-input {
  background: var(--bg-0);
  border: 1px solid var(--accent);
  color: var(--text-main);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.pt-add {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-main);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s;
}
.pt-add:hover { border-color: var(--accent); color: var(--accent); }
.pt-error { color: var(--red); font-size: 10px; margin-top: 2px; text-align: right; }
</style>
