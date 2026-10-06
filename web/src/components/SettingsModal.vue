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

          <!-- ZCode 数据位置 -->
          <section class="sm-sec">
            <div class="sm-sec-title">ZCode 数据位置</div>
            <div class="sm-row sm-inline" style="align-items:flex-start;">
              <span class="sm-label" style="margin-bottom:0;flex-shrink:0;">当前数据库：</span>
              <span class="sm-label" style="color:var(--text-main);word-break:break-all;flex:1;min-width:0;">{{ zcode.db_path || '—' }}</span>
              <span class="tag" :class="zcode.db_exists ? 'tag-ok' : 'tag-fail'" style="flex-shrink:0;">{{ zcode.db_exists ? '正常' : '未找到' }}</span>
            </div>
            <div class="sm-row sm-inline">
              <input
                v-model="zcodeDirInput"
                type="text"
                class="sm-input"
                style="flex:1;min-width:240px;"
                placeholder=".zcode 根目录（其下应含 cli/db/db.sqlite）"
                :disabled="zcode.env_locked"
              />
              <button v-if="pickAvailable" class="sm-btn" :disabled="zcode.env_locked" @click="pickZcodeFolder">浏览...</button>
              <button class="sm-btn" :disabled="savingZcode || zcode.env_locked" @click="saveZcodeDirSettings">{{ savingZcode ? '保存中...' : '保存位置' }}</button>
              <button class="sm-btn sm-btn-ghost" :disabled="savingZcode || zcode.env_locked || !zcode.dir_setting" @click="resetZcodeDir">恢复默认</button>
            </div>
            <div v-if="zcodeMessage" class="sm-note">{{ zcodeMessage }}</div>
            <div v-if="zcodeError" class="sm-error">{{ zcodeError }}</div>
            <div v-if="zcode.env_locked" class="sm-error">已通过环境变量 ZCODE_DB_PATH / ZCODE_CONFIG_PATH 指定路径，界面设置不生效；如需修改请先清除环境变量。</div>
            <div class="sm-note">
              ZCode 数据目录被移动或自定义存储位置导致读取为空时，可在此手动指定 .zcode 根目录；浏览器版请直接粘贴完整路径。优先级：环境变量 &gt; 此设置 &gt; 默认 ~/.zcode。
            </div>
          </section>

          <!-- Webhook 告警推送 -->
          <section class="sm-sec">
            <div class="sm-sec-title">Webhook 告警推送</div>
            <div class="sm-row">
              <label class="sm-check">
                <input v-model="webhook.enabled" type="checkbox" :disabled="webhook.env_locked" />
                启用 Webhook 推送（预算达到 80% / 100% 时推送，每天每级最多一次）
              </label>
            </div>
            <div class="sm-row sm-two-col">
              <label>
                <span class="sm-label">推送目标类型</span>
                <select v-model="webhook.type" class="sm-input" :disabled="webhook.env_locked">
                  <option value="dingtalk">钉钉机器人</option>
                  <option value="feishu">飞书机器人</option>
                  <option value="wecom">企业微信机器人</option>
                  <option value="generic">自定义（JSON）</option>
                </select>
              </label>
              <label>
                <span class="sm-label">Webhook URL（{{ webhook.type === 'generic' ? 'POST JSON' : '机器人 Webhook 地址' }}）</span>
                <input v-model="webhook.url" type="text" class="sm-input" placeholder="https://..." :disabled="webhook.env_locked" />
              </label>
            </div>
            <div class="sm-row sm-inline">
              <button class="sm-btn" :disabled="savingWebhook || webhook.env_locked" @click="saveWebhook">{{ savingWebhook ? '保存中...' : '保存 Webhook' }}</button>
              <button class="sm-btn sm-btn-ghost" :disabled="testingWebhook" @click="doTestWebhook">{{ testingWebhook ? '推送中...' : '发送测试推送' }}</button>
            </div>
            <div v-if="webhookMessage" class="sm-note" :class="{ 'sm-error': webhookFail }">{{ webhookMessage }}</div>
            <div v-if="webhook.env_locked" class="sm-error">已通过环境变量 TOKENVIEW_WEBHOOK_URL 配置，界面设置不生效；如需修改请先清除环境变量。</div>
            <div class="sm-note">URL 仅保存在本机数据目录；钉钉/飞书机器人请把服务器出口 IP 加入白名单（本机部署通常无需配置）。</div>
          </section>

          <!-- 订阅渠道（账单等价价值视图） -->
          <section class="sm-sec">
            <div class="sm-sec-title">订阅渠道（包月制）</div>
            <div class="sm-note" style="margin:0 0 8px;">
              标记为包月订阅的渠道，在月度账单中按「等价市场价值 vs 实际支出（订阅费 + 按量部分）」呈现，并计算订阅是否回本。渠道名需与仪表盘中的渠道名一致。
            </div>
            <div v-for="(s, i) in subs" :key="s.name" class="sm-inline" style="margin-bottom:6px;">
              <span class="sm-label" style="margin:0;color:var(--text-main);">{{ s.name }}</span>
              <span class="sm-label" style="margin:0;">月费 {{ fmtCost(s.monthly_fee) }}</span>
              <button class="sm-btn sm-btn-ghost" @click="removeSub(i)">移除</button>
            </div>
            <div v-if="!subs.length" class="sm-note">尚未标记订阅渠道</div>
            <div class="sm-row sm-inline" style="margin-top:8px;">
              <input v-model="subName" type="text" class="sm-input" style="width:180px;" placeholder="渠道名（与仪表盘一致）" />
              <input v-model="subFee" type="number" min="0" step="1" class="sm-input" style="width:120px;" placeholder="月费（元）" />
              <button class="sm-btn" :disabled="!subName.trim() || subFee === ''" @click="addSub">添加</button>
            </div>
            <div v-if="subMessage" class="sm-note">{{ subMessage }}</div>
          </section>

          <!-- 上报数据保留策略 -->
          <section class="sm-sec">
            <div class="sm-sec-title">上报数据保留策略</div>
            <div class="sm-note" style="margin:0 0 8px;">
              上报接口的数据（reports.jsonl）目前共 {{ fmtNum(reportInfo.records) }} 条。启用后按「最长时间」与「最大条数」自动裁剪（两项可同时生效，0 为不限）；每次上报后检查。
            </div>
            <div class="sm-row">
              <label class="sm-check">
                <input v-model="retention.enabled" type="checkbox" />
                启用保留策略（超出部分将被永久删除，建议先在下方导出备份）
              </label>
            </div>
            <div class="sm-row sm-two-col">
              <label>
                <span class="sm-label">最长保留（天，0 为不限）</span>
                <input v-model="retention.max_age_days" type="number" min="0" step="1" class="sm-input" />
              </label>
              <label>
                <span class="sm-label">最大条数（0 为不限）</span>
                <input v-model="retention.max_lines" type="number" min="0" step="100" class="sm-input" />
              </label>
            </div>
            <div class="sm-row sm-inline">
              <button class="sm-btn" :disabled="savingRetention" @click="saveRetention">{{ savingRetention ? '保存中...' : '保存并立即裁剪' }}</button>
            </div>
            <div v-if="retentionMessage" class="sm-note" :class="{ 'sm-error': retentionFail }">{{ retentionMessage }}</div>
          </section>

          <!-- 上报接口测试 -->
          <section class="sm-sec">
            <div class="sm-sec-title">上报接口测试</div>
            <div class="sm-row sm-inline">
              <span class="sm-label" style="margin:0;">本机地址：<b style="color:var(--text-main);">{{ origin }}</b></span>
              <span class="tag" :class="reportInfo.auth_enabled ? 'tag-fail' : 'tag-ok'">{{ reportInfo.auth_enabled ? '已启用鉴权' : '未启用鉴权' }}</span>
            </div>
            <div class="sm-row sm-inline">
              <div class="seg">
                <button v-for="l in Object.keys(reportSamples)" :key="l" :class="{ active: sampleLang === l }" @click="sampleLang = l">{{ l }}</button>
              </div>
              <button class="sm-btn sm-btn-ghost" @click="copySample">复制代码</button>
            </div>
            <pre class="sm-code">{{ reportSamples[sampleLang] }}</pre>
            <div class="sm-row sm-inline">
              <button class="sm-btn" :disabled="sendingTest" @click="sendTest">{{ sendingTest ? '发送中...' : '发送测试上报' }}</button>
              <span class="sm-note" style="margin:0;">测试上报会写入真实统计（渠道 tokenview-test），可在调用明细中查看，也可被保留策略清理。</span>
            </div>
            <div v-if="testMessage" class="sm-note" :class="{ 'sm-error': testFail }">{{ testMessage }}</div>
            <div v-if="reportInfo.auth_enabled" class="sm-note">启用鉴权后测试上报需在环境变量 TOKENVIEW_REPORT_TOKEN 对应的请求头 x-report-token 中携带令牌；示例代码中的令牌为占位符，请自行替换。</div>
          </section>

          <!-- 数据备份 / 恢复 -->
          <section class="sm-sec">
            <div class="sm-sec-title">数据备份 / 恢复</div>
            <div class="sm-note" style="margin:0 0 8px;">
              打包上报数据、自定义单价、预算、应用设置与在线价目快照为单个 JSON 文件；导入时逐文件校验，未知或损坏文件自动跳过。
            </div>
            <div class="sm-row sm-inline">
              <button class="sm-btn" :disabled="exportingBackup" @click="doExportBackup">{{ exportingBackup ? '导出中...' : '导出备份' }}</button>
              <label class="sm-btn" style="cursor:pointer;">
                选择备份文件...
                <input type="file" accept=".json,application/json" style="display:none;" @change="onBackupFile" />
              </label>
            </div>
            <div v-if="pendingImport" class="sm-import-box">
              <div class="sm-label">备份时间：{{ pendingImport.exported_at || '未知' }}，包含：</div>
              <div v-for="f in pendingImport.fileList" :key="f.name" class="sm-label" style="margin-left:10px;">
                {{ f.name }}{{ f.present ? `（${fmtNum(Math.ceil(f.bytes / 1024))} KB）` : '（备份中不存在）' }}
              </div>
              <div class="sm-error" style="margin-top:6px;">导入将覆盖当前同名配置（含 Webhook / 订阅渠道等全部设置），确定继续吗？</div>
              <div class="sm-inline">
                <button class="sm-btn" :disabled="importingBackup" @click="doImportBackup">{{ importingBackup ? '导入中...' : '确认导入' }}</button>
                <button class="sm-btn sm-btn-ghost" :disabled="importingBackup" @click="pendingImport = null">取消</button>
              </div>
            </div>
            <div v-if="backupMessage" class="sm-note" :class="{ 'sm-error': backupFail }">{{ backupMessage }}</div>
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
          <section v-if="trayAvailable || autoLaunchAvailable" class="sm-sec">
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
            <div v-if="autoLaunchAvailable" class="sm-row">
              <label class="sm-check">
                <input
                  type="checkbox"
                  :checked="autoLaunch"
                  @change="setAutoLaunch($event.target.checked)"
                />
                开机自启（随系统启动并静默最小化到托盘，不弹出窗口）
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import {
  fetchBudget, saveBudget, fetchHealth, fetchSettings, saveFxRate, saveZcodeDir,
  saveWebhookSettings, testWebhook, saveSubscriptionChannels, saveRetentionSettings,
  sendTestReport, downloadBackup, importBackup
} from '../api';
import { fmtCost, fmtNum } from '../utils/format';
import { saveBlobResponse } from '../utils/download';

const props = defineProps({
  visible: { type: Boolean, default: false }
});
const emit = defineEmits(['close', 'budget-changed', 'data-changed']);

const form = reactive({ enabled: false, daily: 0, monthly: 0 });
const status = reactive({ today_cost: 0, month_cost: 0, daily_ratio: 0, monthly_ratio: 0 });
const savingBudget = ref(false);
const budgetError = ref('');

const fxInput = ref('');
const fxEffective = ref('6.8');
const fxSourceText = ref('');
const savingFx = ref(false);
const fxMessage = ref('');

const zcode = reactive({ db_path: '', db_exists: false, dir_setting: '', source: 'default', env_locked: false });
const zcodeDirInput = ref('');
const savingZcode = ref(false);
const zcodeMessage = ref('');
const zcodeError = ref('');
const pickAvailable = !!(typeof window !== 'undefined' && window.tokenview && window.tokenview.pickFolder);

const health = ref([]);

const trayAvailable = !!(typeof window !== 'undefined' && window.tokenview && window.tokenview.setCloseToTray);
const closeToTray = ref(trayAvailable ? !!window.tokenview.getCloseToTray() : false);

const autoLaunchAvailable = !!(typeof window !== 'undefined' && window.tokenview && window.tokenview.setAutoLaunch);
const autoLaunch = ref(autoLaunchAvailable ? !!window.tokenview.getAutoLaunch() : false);

/* ---- Webhook 告警推送 ---- */
const webhook = reactive({ enabled: false, url: '', type: 'dingtalk', env_locked: false });
const savingWebhook = ref(false);
const testingWebhook = ref(false);
const webhookMessage = ref('');
const webhookFail = ref(false);

async function saveWebhook() {
  webhookMessage.value = '';
  webhookFail.value = false;
  const url = webhook.url.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    webhookMessage.value = 'URL 需以 http(s):// 开头';
    webhookFail.value = true;
    return;
  }
  savingWebhook.value = true;
  try {
    const r = await saveWebhookSettings(webhook.enabled, url, webhook.type);
    Object.assign(webhook, { enabled: r.enabled, url: r.url, type: r.type, env_locked: r.env_locked });
    webhookMessage.value = r.url ? '已保存，预算告警将按新配置推送' : '已清除 Webhook 配置';
  } catch (e) {
    webhookMessage.value = e.message || '保存失败';
    webhookFail.value = true;
  } finally {
    savingWebhook.value = false;
  }
}

async function doTestWebhook() {
  webhookMessage.value = '';
  webhookFail.value = false;
  testingWebhook.value = true;
  try {
    const r = await testWebhook();
    webhookMessage.value = r.message || '推送成功';
  } catch (e) {
    webhookMessage.value = e.message || '推送失败';
    webhookFail.value = true;
  } finally {
    testingWebhook.value = false;
  }
}

/* ---- 订阅渠道 ---- */
const subs = ref([]);
const subName = ref('');
const subFee = ref('');
const subMessage = ref('');

async function persistSubs(next, note) {
  try {
    subs.value = await saveSubscriptionChannels(next);
    subMessage.value = note || '已保存';
  } catch (e) {
    subMessage.value = e.message || '保存失败';
  }
}

function addSub() {
  const name = subName.value.trim();
  const fee = Number(subFee.value);
  if (!name) return;
  if (!Number.isFinite(fee) || fee < 0) {
    subMessage.value = '月费必须为不小于 0 的数字';
    return;
  }
  if (subs.value.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    subMessage.value = '该渠道已在列表中（如需调整费率请先移除再添加）';
    return;
  }
  subName.value = '';
  subFee.value = '';
  persistSubs([...subs.value, { name, monthly_fee: fee }], `已添加「${name}」`);
}

function removeSub(i) {
  const removed = subs.value[i];
  persistSubs(subs.value.filter((_, idx) => idx !== i), `已移除「${removed.name}」`);
}

/* ---- 上报数据保留策略 ---- */
const retention = reactive({ enabled: false, max_age_days: 0, max_lines: 0 });
const savingRetention = ref(false);
const retentionMessage = ref('');
const retentionFail = ref(false);

async function saveRetention() {
  retentionMessage.value = '';
  retentionFail.value = false;
  const age = Math.max(0, Math.floor(Number(retention.max_age_days) || 0));
  const lines = Math.max(0, Math.floor(Number(retention.max_lines) || 0));
  if (retention.enabled && !age && !lines) {
    retentionMessage.value = '启用后至少要填写一项阈值（天数或条数）';
    retentionFail.value = true;
    return;
  }
  savingRetention.value = true;
  try {
    const r = await saveRetentionSettings(retention.enabled, age, lines);
    Object.assign(retention, { enabled: r.enabled, max_age_days: r.max_age_days, max_lines: r.max_lines });
    const applied = r.applied;
    retentionMessage.value = applied && applied.removed > 0
      ? `已保存并裁剪：删除 ${applied.removed} 条，保留 ${applied.kept} 条`
      : '已保存（当前无需裁剪）';
    if (r.apply_error) {
      retentionMessage.value += `；裁剪失败：${r.apply_error}`;
      retentionFail.value = true;
    }
  } catch (e) {
    retentionMessage.value = e.message || '保存失败';
    retentionFail.value = true;
  } finally {
    savingRetention.value = false;
  }
}

/* ---- 上报接口测试 ---- */
const reportInfo = reactive({ auth_enabled: false, records: 0, bytes: 0 });
const origin = typeof window !== 'undefined' ? window.location.origin : '';
const sampleLang = ref('curl');
const sampleLangs = ['curl', 'JavaScript', 'Python'];
const sendingTest = ref(false);
const testMessage = ref('');
const testFail = ref(false);

function buildSample(lang) {
  const tokenHeader = reportInfo.auth_enabled;
  if (lang === 'curl') {
    return [
      `curl -X POST ${origin}/api/usage/report \\`,
      `  -H "Content-Type: application/json" \\`,
      ...(tokenHeader ? [`  -H "x-report-token: <替换为令牌>" \\`] : []),
      `  -d '{"channel":"deepseek","model":"deepseek-chat","prompt_tokens":1234,"completion_tokens":567,"tool":"Trae","request_id":"demo-001"}'`
    ].join('\n');
  }
  if (lang === 'JavaScript') {
    return [
      `const res = await fetch('${origin}/api/usage/report', {`,
      `  method: 'POST',`,
      `  headers: { 'Content-Type': 'application/json'${tokenHeader ? ", 'x-report-token': '<替换为令牌>'" : ''} },`,
      `  body: JSON.stringify({`,
      `    channel: 'deepseek', model: 'deepseek-chat',`,
      `    prompt_tokens: 1234, completion_tokens: 567,`,
      `    tool: 'Trae', request_id: 'demo-001'`,
      `  })`,
      `});`,
      `console.log(await res.json());`
    ].join('\n');
  }
  return [
    `import requests`,
    ``,
    `res = requests.post('${origin}/api/usage/report', json={`,
    `    'channel': 'deepseek', 'model': 'deepseek-chat',`,
    `    'prompt_tokens': 1234, 'completion_tokens': 567,`,
    `    'tool': 'Trae', 'request_id': 'demo-001',`,
    `}, headers=${tokenHeader ? "{'x-report-token': '<替换为令牌>'}" : '{}'})`,
    `print(res.json())`
  ].join('\n');
}

const reportSamples = computed(() => ({
  curl: buildSample('curl'),
  JavaScript: buildSample('JavaScript'),
  Python: buildSample('Python')
}));

async function copySample() {
  try {
    await navigator.clipboard.writeText(reportSamples.value[sampleLang.value]);
    testMessage.value = '代码已复制到剪贴板';
    testFail.value = false;
  } catch { /* 剪贴板不可用（非安全上下文常见），静默 */ }
}

async function sendTest() {
  testMessage.value = '';
  testFail.value = false;
  sendingTest.value = true;
  try {
    const r = await sendTestReport({
      channel: 'tokenview-test',
      model: 'deepseek-chat',
      prompt_tokens: 1000,
      completion_tokens: 500,
      tool: 'api',
      request_id: `tokenview-test-${Date.now()}`
    });
    testMessage.value = `上报成功：${r.total_tokens} tokens，估算费用 ${fmtCost(r.cost)}（request_id ${r.request_id}）`;
  } catch (e) {
    testMessage.value = e.message || '上报失败';
    testFail.value = true;
  } finally {
    sendingTest.value = false;
  }
}

/* ---- 数据备份 / 恢复 ---- */
const exportingBackup = ref(false);
const importingBackup = ref(false);
const pendingImport = ref(null);
const backupMessage = ref('');
const backupFail = ref(false);

async function doExportBackup() {
  backupMessage.value = '';
  backupFail.value = false;
  exportingBackup.value = true;
  try {
    const res = await downloadBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlobResponse(res, `tokenview-backup-${stamp}.json`);
    backupMessage.value = '备份已导出';
  } catch (e) {
    backupMessage.value = e.message || '导出失败';
    backupFail.value = true;
  } finally {
    exportingBackup.value = false;
  }
}

async function onBackupFile(ev) {
  backupMessage.value = '';
  backupFail.value = false;
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // 允许重复选择同一文件
  if (!file) return;
  let bundle = null;
  try {
    bundle = JSON.parse(await file.text());
  } catch {
    backupMessage.value = '文件不是有效的 JSON';
    backupFail.value = true;
    return;
  }
  if (!bundle || bundle.app !== 'TokenView' || !bundle.files || typeof bundle.files !== 'object') {
    backupMessage.value = '这不是 TokenView 的备份文件';
    backupFail.value = true;
    return;
  }
  pendingImport.value = {
    bundle,
    exported_at: bundle.exported_at,
    fileList: Object.entries(bundle.files).map(([name, content]) => ({
      name,
      present: content != null,
      bytes: typeof content === 'string' ? content.length : 0
    }))
  };
}

async function doImportBackup() {
  if (!pendingImport.value || importingBackup.value) return;
  importingBackup.value = true;
  backupMessage.value = '';
  backupFail.value = false;
  try {
    const r = await importBackup(JSON.stringify(pendingImport.value.bundle));
    const skippedNote = r.skipped.length ? `；跳过 ${r.skipped.length} 个（${r.skipped.map((s) => s.name).join('、')}）` : '';
    backupMessage.value = `${r.message}${skippedNote}；数据已即时生效`;
    pendingImport.value = null;
    emit('data-changed');
  } catch (e) {
    backupMessage.value = e.message || '导入失败';
    backupFail.value = true;
  } finally {
    importingBackup.value = false;
  }
}

/* ---- 桌面端开机自启 ---- */
function setAutoLaunch(v) {
  autoLaunch.value = !!v;
  if (autoLaunchAvailable) {
    try { window.tokenview.setAutoLaunch(!!v); } catch { /* IPC 不可用时忽略 */ }
  }
}

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
  zcodeMessage.value = '';
  zcodeError.value = '';
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
    if (s.zcode) {
      Object.assign(zcode, {
        db_path: s.zcode.db_path || '',
        db_exists: !!s.zcode.db_exists,
        dir_setting: s.zcode.dir_setting || '',
        source: s.zcode.source || 'default',
        env_locked: !!s.zcode.env_locked
      });
      zcodeDirInput.value = s.zcode.dir_setting || '';
    }
    if (s.webhook) Object.assign(webhook, s.webhook);
    if (Array.isArray(s.subscription_channels)) subs.value = s.subscription_channels;
    if (s.retention) Object.assign(retention, s.retention);
    if (s.report) Object.assign(reportInfo, s.report);
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

/* ---- ZCode 数据位置 ---- */

/** 用接口返回的最新状态刷新本地展示 */
function applyZcodeStatus(s) {
  if (!s) return;
  Object.assign(zcode, {
    db_path: s.db_path || '',
    db_exists: !!s.db_exists,
    dir_setting: s.dir_setting || '',
    source: s.source || 'default',
    env_locked: !!s.env_locked
  });
}

async function saveZcodeDirSettings() {
  zcodeMessage.value = '';
  zcodeError.value = '';
  const dir = zcodeDirInput.value.trim();
  if (!dir) {
    zcodeError.value = '请填写 .zcode 根目录，或点击"恢复默认"清除自定义位置';
    return;
  }
  savingZcode.value = true;
  try {
    const r = await saveZcodeDir(dir);
    applyZcodeStatus(r);
    zcodeMessage.value = '已保存，ZCode 数据源已切换到新位置';
    emit('data-changed');
  } catch (e) {
    zcodeError.value = e.message || '保存失败';
  } finally {
    savingZcode.value = false;
  }
}

async function resetZcodeDir() {
  zcodeMessage.value = '';
  zcodeError.value = '';
  savingZcode.value = true;
  try {
    const r = await saveZcodeDir('');
    applyZcodeStatus(r);
    zcodeDirInput.value = '';
    zcodeMessage.value = '已恢复默认位置（~/.zcode）';
    emit('data-changed');
  } catch (e) {
    zcodeError.value = e.message || '操作失败';
  } finally {
    savingZcode.value = false;
  }
}

/** 桌面端原生目录选择（浏览器版不展示该按钮） */
async function pickZcodeFolder() {
  try {
    const p = await window.tokenview.pickFolder();
    if (p) zcodeDirInput.value = p;
  } catch { /* 用户取消或 IPC 不可用 */ }
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
.sm-note.sm-error { color: var(--red); }
.sm-code {
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-main);
  overflow-x: auto;
  white-space: pre;
  font-family: 'Cascadia Code', Consolas, monospace;
  margin-bottom: 8px;
}
.sm-import-box {
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 10px;
  margin-top: 8px;
}
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
