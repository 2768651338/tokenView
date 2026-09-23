<template>
  <teleport to="body">
    <div v-if="visible" class="sm-overlay" @click.self="close" @keydown.esc="close">
      <div class="sm-modal" role="dialog" aria-label="设置">
        <div class="sm-head">
          <span>设置</span>
          <button class="sm-close" @click="close">×</button>
        </div>

        <div class="sm-body">
          <!-- 预算告警 -->
          <section class="sm-sec">
            <div class="sm-sec-title">预算告警</div>
            <div class="sm-row">
              <label class="sm-check">
                <input v-model="form.enabled" type="checkbox" />
                启用预算告警（达到 80% 提醒，100% 告警，支持桌面通知）
              </label>
            </div>
            <div class="sm-row sm-two-col">
              <label>
                <span class="sm-label">日预算（元，0 为不限）</span>
                <input v-model="form.daily" type="number" min="0" step="1" class="sm-input" />
              </label>
              <label>
                <span class="sm-label">月预算（元，0 为不限）</span>
                <input v-model="form.monthly" type="number" min="0" step="1" class="sm-input" />
              </label>
            </div>
            <div class="sm-row" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
              <div style="flex:1;min-width:220px;">
                <div class="sm-bar-label">
                  <span>今日 {{ fmtCost(status.today_cost) }}</span>
                  <span>{{ budget.pct(form.daily, status.today_cost) }}%</span>
                </div>
                <div class="sm-bar"><div class="sm-bar-fill" :style="barStyle(status.today_cost, form.daily)"></div></div>
              </div>
              <div style="flex:1;min-width:220px;">
                <div class="sm-bar-label">
                  <span>本月 {{ fmtCost(status.month_cost) }}</span>
                  <span>{{ budget.pct(form.monthly, status.month_cost) }}%</span>
                </div>
                <div class="sm-bar"><div class="sm-bar-fill" :style="barStyle(status.month_cost, form.monthly)"></div></div>
              </div>
            </div>
            <div v-if="budgetError" class="sm-error">{{ budgetError }}</div>
            <div class="sm-actions">
              <button class="sm-btn" :disabled="savingBudget" @click="saveBudgetSettings">{{ savingBudget ? '保存中...' : '保存预算' }}</button>
            </div>
          </section>

          <!-- 汇率设置 -->
          <section class="sm-sec">
            <div class="sm-sec-title">美元汇率（在线价目换算）</div>
            <div class="sm-row sm-inline">
              <span class="sm-label">当前生效：1 USD = {{ fxEffective }} CNY</span>
              <span class="sm-label" style="color:var(--text-faint);">{{ fxSourceText }}</span>
            </div>
            <div class="sm-row sm-inline">
              <input v-model="fxInput" type="number" min="0" step="0.01" class="sm-input" style="width:120px;" placeholder="如 7.2" />
              <button class="sm-btn" :disabled="savingFx" @click="saveFx">{{ savingFx ? '保存中...' : '保存汇率' }}</button>
              <button class="sm-btn sm-btn-ghost" :disabled="savingFx" @click="clearFx">清除覆盖</button>
            </div>
            <div v-if="fxMessage" class="sm-note">{{ fxMessage }}</div>
            <div class="sm-note">保存后按新汇率本地重算在线价目；自定义单价不受影响。</div>
          </section>

          <!-- 数据源健康 -->
          <section class="sm-sec">
            <div class="sm-sec-title">数据源健康</div>
            <div class="table-wrap" style="max-height:240px;">
              <table class="usage-table">
                <thead>
                  <tr>
                    <th>数据源</th>
                    <th>状态</th>
                    <th style="text-align:right;">调用</th>
                    <th>最近使用</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in health" :key="s.id">
                    <td style="font-weight:600;">{{ s.name }}</td>
                    <td>
                      <span class="tag" :class="s.healthy ? 'tag-ok' : 'tag-fail'">{{ s.healthy ? '正常' : '异常' }}</span>
                      <span v-if="s.reason" class="sm-reason" :title="s.reason">{{ s.reason }}</span>
                    </td>
                    <td style="text-align:right;">{{ fmtNum(s.calls) }}</td>
                    <td style="color:var(--text-sub);">{{ s.last_used || '—' }}</td>
                  </tr>
                  <tr v-if="!health.length">
                    <td colspan="4" style="text-align:center;color:var(--text-faint);padding:20px;">加载中...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 桌面端选项 -->
          <section v-if="trayAvailable" class="sm-sec">
            <div class="sm-sec-title">桌面端</div>
            <div class="sm-row">
              <label class="sm-check">
                <input
                  type="checkbox"
                  :checked="closeToTray"
                  @change="setCloseToTray($event.target.checked)"
                />
                关闭窗口时最小化到系统托盘（不勾选则保持原有行为：关闭即退出）
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { fetchBudget, saveBudget, fetchHealth, fetchSettings, saveFxRate } from '../api';
import { fmtCost, fmtNum } from '../utils/format';

const props = defineProps({
  visible: { type: Boolean, default: false }
});
const emit = defineEmits(['close', 'budget-changed']);

const form = reactive({ enabled: false, daily: 0, monthly: 0 });
const status = reactive({ today_cost: 0, month_cost: 0, daily_ratio: 0, monthly_ratio: 0 });
const savingBudget = ref(false);
const budgetError = ref('');

const fxInput = ref('');
const fxEffective = ref('6.8');
const fxSourceText = ref('');
const savingFx = ref(false);
const fxMessage = ref('');

const health = ref([]);

const trayAvailable = !!(typeof window !== 'undefined' && window.tokenview && window.tokenview.setCloseToTray);
const closeToTray = ref(trayAvailable ? !!window.tokenview.getCloseToTray() : false);

const budget = {
  /** 预算占比文本（未设预算显示 —） */
  pct(limit, used) {
    const l = Number(limit) || 0;
    if (l <= 0) return '—';
    return Math.min(999, Math.round((Number(used) || 0) / l * 100));
  }
};

function barStyle(used, limit) {
  const l = Number(limit) || 0;
  const u = Number(used) || 0;
  if (l <= 0) return { width: 0, background: 'var(--border-subtle)' };
  const ratio = Math.min(100, u / l * 100);
  const color = ratio >= 100 ? 'var(--red)' : ratio >= 80 ? 'var(--amber)' : 'var(--accent)';
  return { width: Math.max(ratio, 1.5) + '%', background: color };
}

async function loadAll() {
  budgetError.value = '';
  fxMessage.value = '';
  try {
    const b = await fetchBudget();
    form.enabled = !!b.enabled;
    form.daily = Number(b.daily) || 0;
    form.monthly = Number(b.monthly) || 0;
    status.today_cost = b.today_cost;
    status.month_cost = b.month_cost;
    status.daily_ratio = b.daily_ratio;
    status.monthly_ratio = b.monthly_ratio;
  } catch { /* 打开设置时读取失败：保持默认，保存时会再报错 */ }
  try {
    const s = await fetchSettings();
    fxEffective.value = s.fx_effective;
    fxSourceText.value = s.fx_rate ? '当前为手动覆盖' : '未覆盖（环境变量或默认值）';
    fxInput.value = s.fx_rate || '';
  } catch { /* 同上 */ }
  try {
    const h = await fetchHealth();
    health.value = h.sources || [];
  } catch { /* 列表保持空态 */ }
}

async function saveBudgetSettings() {
  budgetError.value = '';
  const daily = Number(form.daily);
  const monthly = Number(form.monthly);
  if (Number.isFinite(daily) && daily < 0) { budgetError.value = '日预算不能为负数'; return; }
  if (Number.isFinite(monthly) && monthly < 0) { budgetError.value = '月预算不能为负数'; return; }
  savingBudget.value = true;
  try {
    const s = await saveBudget(Math.max(0, daily) || 0, Math.max(0, monthly) || 0, !!form.enabled);
    status.today_cost = s.today_cost;
    status.month_cost = s.month_cost;
    // 启用告警时申请桌面通知权限（需用户手势触发）
    if (form.enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch { /* 忽略 */ }
    }
    emit('budget-changed');
  } catch (e) {
    budgetError.value = e.message || '保存失败';
  } finally {
    savingBudget.value = false;
  }
}

async function saveFx() {
  fxMessage.value = '';
  const v = Number(fxInput.value);
  if (fxInput.value !== '' && (!Number.isFinite(v) || v <= 0)) {
    fxMessage.value = '汇率必须为大于 0 的数字';
    return;
  }
  savingFx.value = true;
  try {
    const r = await saveFxRate(fxInput.value === '' ? null : v);
    const s = await fetchSettings();
    fxEffective.value = s.fx_effective;
    fxSourceText.value = s.fx_rate ? '当前为手动覆盖' : '未覆盖（环境变量或默认值）';
    if (r.reconvert_error) {
      fxMessage.value = `已保存，但在线价目未能重算：${r.reconvert_error}`;
    } else {
      fxMessage.value = r.reconverted ? `已保存，并按新汇率重算 ${r.reconverted} 条在线价目` : '已保存（当前无在线价目快照）';
    }
  } catch (e) {
    fxMessage.value = e.message || '保存失败';
  } finally {
    savingFx.value = false;
  }
}

async function clearFx() {
  fxMessage.value = '';
  savingFx.value = true;
  try {
    const r = await saveFxRate(null);
    const s = await fetchSettings();
    fxEffective.value = s.fx_effective;
    fxSourceText.value = s.fx_rate ? '当前为手动覆盖' : '未覆盖（环境变量或默认值）';
    fxInput.value = '';
    fxMessage.value = r.reconvert_error ? `已清除覆盖，但重算失败：${r.reconvert_error}` : '已清除覆盖并按默认/环境变量汇率重算';
  } catch (e) {
    fxMessage.value = e.message || '操作失败';
  } finally {
    savingFx.value = false;
  }
}

function setCloseToTray(v) {
  closeToTray.value = !!v;
  if (trayAvailable) window.tokenview.setCloseToTray(!!v);
}

function close() {
  emit('close');
}

watch(() => props.visible, (v) => {
  if (v) loadAll();
});
</script>

<style scoped>
.sm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.sm-modal {
  width: 640px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
}
.sm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
  font-weight: 600;
}
.sm-close {
  border: none;
  background: transparent;
  color: var(--text-sub);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
}
.sm-close:hover { color: var(--text-main); background: var(--border-subtle); }
.sm-body { padding: 6px 16px 16px; overflow-y: auto; }
.sm-sec { padding: 14px 0; border-bottom: 1px solid var(--border-subtle); }
.sm-sec:last-child { border-bottom: none; }
.sm-sec-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 10px;
}
.sm-row { margin-bottom: 10px; }
.sm-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sm-label { font-size: 11.5px; color: var(--text-sub); display: block; margin-bottom: 4px; }
.sm-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-main);
  cursor: pointer;
}
.sm-check input { accent-color: var(--accent); }
.sm-input {
  width: 100%;
  background: var(--bg-0);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12.5px;
  outline: none;
  font-family: inherit;
}
.sm-input:focus { border-color: var(--accent); }
.sm-inline { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.sm-btn {
  border: 1px solid var(--card-border);
  background: var(--bg-0);
  color: var(--text-main);
  border-radius: 4px;
  padding: 5px 14px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.sm-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.sm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sm-btn-ghost { color: var(--text-sub); }
.sm-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--border-subtle);
  overflow: hidden;
}
.sm-bar-fill { height: 100%; border-radius: 4px; transition: width 0.2s; }
.sm-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-sub);
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}
.sm-error { color: var(--red); font-size: 11.5px; margin-bottom: 8px; }
.sm-note { color: var(--text-faint); font-size: 11px; margin-top: 6px; }
.sm-reason {
  margin-left: 8px;
  font-size: 11px;
  color: var(--text-faint);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
