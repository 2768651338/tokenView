<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>会话统计</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        {{ total }} 个会话 · ZCode / Claude Code / Codex · 近 {{ days === 'all' ? '全部' : days + ' 天' }}
      </span>
    </div>

    <!-- 全文搜索：跨会话检索消息正文与会话标题 -->
    <div class="ss-search">
      <input
        v-model="searchQuery"
        type="text"
        class="ss-search-input"
        placeholder="搜索会话内容，如：登录 / tokenView / 报错关键词（Enter 搜索）"
        @keydown.enter="doSearch"
      />
      <select v-model="searchDays" class="ss-search-days" title="搜索范围">
        <option value="all">全部时间</option>
        <option :value="7">近 7 天</option>
        <option :value="30">近 30 天</option>
        <option :value="90">近 90 天</option>
      </select>
      <button class="detail-btn ss-search-btn" :disabled="searching || !searchQuery.trim()" @click="doSearch">
        {{ searching ? '搜索中...' : '搜索' }}
      </button>
      <button v-if="searchResult" class="detail-btn" @click="clearSearch">清除</button>
    </div>
    <div v-if="searchError" class="ss-search-error">{{ searchError }}</div>
    <div v-if="searchResult" class="ss-search-meta">
      命中 {{ searchResult.total_sessions }} 个会话{{ searchResult.truncated ? '（扫描量达上限，结果可能不全）' : '' }}，展示最近活跃的前 {{ searchResult.list.length }} 个
    </div>
    <div v-if="searchResult" class="table-wrap ss-result-wrap">
      <table class="usage-table">
        <thead>
          <tr>
            <th>最近命中</th>
            <th>会话</th>
            <th>项目</th>
            <th>来源</th>
            <th style="text-align:right;">命中次数</th>
            <th>片段</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in searchResult.list" :key="s.source + s.session_id" class="session-row" @click="openDetail(s)">
            <td style="color:var(--text-sub);white-space:nowrap;">{{ s.last_time }}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;" :title="s.title">{{ s.title }}</td>
            <td style="color:var(--text-sub);">{{ s.project || '—' }}</td>
            <td><span class="chip">{{ s.source_name }}</span></td>
            <td style="text-align:right;">{{ s.matches }}</td>
            <td class="ss-snippet" :title="s.snippet" v-html="highlight(s.snippet, searchResult.query)"></td>
            <td style="text-align:right;">
              <button class="detail-btn" @click.stop="openDetail(s)">详情</button>
            </td>
          </tr>
          <tr v-if="!searchResult.list.length">
            <td colspan="7" style="text-align:center;color:var(--text-faint);padding:20px;">没有匹配的会话</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="table-wrap" style="max-height:340px;">
      <table class="usage-table">
        <thead>
          <tr>
            <th>最近活动</th>
            <th>会话</th>
            <th>项目</th>
            <th>来源</th>
            <th style="text-align:right;">调用</th>
            <th style="text-align:right;">失败</th>
            <th style="text-align:right;">Tokens</th>
            <th style="text-align:right;">费用</th>
            <th style="text-align:right;">子代理</th>
            <th style="text-align:right;">代码增删</th>
            <th style="text-align:right;">上下文</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in list" :key="s.id" class="session-row" @click="openDetail(s)">
            <td style="color:var(--text-sub);">{{ s.last_at }}</td>
            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;" :title="s.title">
              {{ s.title }}
              <span v-if="s.is_subagent_session" class="sub-mark" title="以子代理调用为主">子代理</span>
            </td>
            <td style="color:var(--text-sub);">{{ s.project || '—' }}</td>
            <td><span class="chip">{{ s.source_name }}</span></td>
            <td style="text-align:right;">{{ fmtNum(s.calls) }}</td>
            <td style="text-align:right;" :style="s.failed ? 'color:var(--red);' : 'color:var(--text-faint);'">{{ s.failed || '—' }}</td>
            <td style="text-align:right;font-weight:600;">{{ fmtTokens(s.tokens) }}</td>
            <td style="text-align:right;color:var(--amber);">{{ fmtCost(s.cost) }}</td>
            <td style="text-align:right;color:var(--text-sub);">{{ s.subagent_calls ? fmtNum(s.subagent_calls) : '—' }}</td>
            <td style="text-align:right;">
              <span v-if="s.additions != null" style="color:var(--green);">+{{ fmtNum(s.additions) }}</span>
              <span v-if="s.deletions != null" style="color:var(--red);margin-left:4px;">-{{ fmtNum(s.deletions) }}</span>
              <span v-if="s.additions == null && s.deletions == null" style="color:var(--text-faint);">—</span>
            </td>
            <td style="text-align:right;">
              <div v-if="s.ctx_ratio != null" class="ctx-wrap" :title="`会话累计 ${fmtTokens(s.ctx_used)} / 窗口 ${fmtTokens(s.ctx_window)}`">
                <div class="ctx-bar"><div class="ctx-fill" :style="ctxStyle(s.ctx_ratio)"></div></div>
                <span class="ctx-text">{{ s.ctx_ratio }}%</span>
              </div>
              <span v-else style="color:var(--text-faint);">—</span>
            </td>
            <td style="text-align:right;">
              <button class="detail-btn" @click.stop="openDetail(s)">详情</button>
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="12" style="text-align:center;color:var(--text-faint);padding:24px;">
              所选范围内没有带会话标识的调用（会话维度来自 ZCode / Claude Code / Codex）
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 会话详情弹窗 -->
    <teleport to="body">
      <div v-if="detail" class="sd-overlay" @click.self="closeDetail">
        <div ref="detailDialog" class="sd-modal" role="dialog" aria-modal="true" aria-label="会话详情" tabindex="-1">
          <div class="sd-head">
            <span class="sd-title">{{ detail.title || detail.session_id }}</span>
            <button class="sd-close" aria-label="关闭会话详情" @click="closeDetail">×</button>
          </div>
          <div class="sd-body">
            <div class="sd-meta">
              <span class="chip">{{ detail.source_name }}</span>
              <span v-if="detail.project" class="sd-meta-item">项目：{{ detail.project }}</span>
              <span class="sd-meta-item">{{ detail.summary.first_at }} ~ {{ detail.summary.last_at }}</span>
              <span class="sd-meta-item">{{ fmtNum(detail.summary.calls) }} 次调用</span>
              <span v-if="detail.summary.failed" class="sd-meta-item" style="color:var(--red);">失败 {{ detail.summary.failed }}</span>
              <span class="sd-meta-item">{{ fmtTokens(detail.summary.tokens) }} tokens</span>
              <span class="sd-meta-item" style="color:var(--amber);">{{ fmtCost(detail.summary.cost) }}</span>
              <span v-if="detail.summary.models && detail.summary.models.length" class="sd-meta-item">{{ detail.summary.models.join(' / ') }}</span>
            </div>
            <div v-if="detailLoading" style="text-align:center;color:var(--text-faint);padding:32px 0;">加载中...</div>
            <div v-else-if="detail.loadError" role="alert" style="color:var(--red);padding:24px 0;">
              {{ detail.loadError }} <button class="detail-btn" @click="openDetail(detail)">重试</button>
            </div>
            <template v-else-if="detail.messages && detail.messages.length">
              <div class="sd-msgs">
                <div v-for="(m, i) in detail.messages" :key="i" class="sd-msg" :class="m.role">
                  <div class="sd-msg-role">{{ roleLabel(m.role) }}<span class="sd-msg-time">{{ fmtMsgTime(m.time) }}</span></div>
                  <div v-for="(p, j) in m.parts" :key="j" class="sd-part" :class="p.kind">{{ p.text }}</div>
                </div>
              </div>
              <div v-if="detail.message_total > detail.messages.length" class="sd-more">
                仅展示最近 {{ detail.messages.length }} 条消息（共 {{ detail.message_total }} 条）
              </div>
            </template>
            <div v-else style="text-align:center;color:var(--text-faint);padding:32px 0;">
              {{ detail.source === 'zcode' ? '该会话暂无可预览的消息' : '该来源不提供消息预览（仅 ZCode 支持）' }}
            </div>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDialog } from '../composables/useDialog';
import { fetchSessionDetail, searchSessions } from '../api';
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';

defineProps({
  list: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  days: { type: [Number, String], default: 30 }
});

const detail = ref(null);
const detailLoading = ref(false);
const detailDialog = ref(null);
let detailRequest = 0;
useDialog(() => !!detail.value, detailDialog, closeDetail);

/* ---- 全文搜索 ---- */
const searchQuery = ref('');
const searchDays = ref('all');
const searching = ref(false);
const searchResult = ref(null);
const searchError = ref('');

async function doSearch() {
  const q = searchQuery.value.trim();
  if (!q || searching.value) return;
  searching.value = true;
  searchError.value = '';
  try {
    searchResult.value = await searchSessions(q, searchDays.value, 20);
  } catch (e) {
    searchError.value = e.message || '搜索失败';
    searchResult.value = null;
  } finally {
    searching.value = false;
  }
}

function clearSearch() {
  searchResult.value = null;
  searchError.value = '';
  searchQuery.value = '';
}

/** 摘要关键词高亮：先整体 HTML 转义再按字面量拆分包 <mark>，避免注入 */
function highlight(snippet, query) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const q = String(query || '').trim();
  if (!q) return esc(snippet);
  const lower = String(snippet).toLowerCase();
  const ql = q.toLowerCase();
  const parts = [];
  let i = 0;
  while (i <= lower.length) {
    const idx = lower.indexOf(ql, i);
    if (idx < 0) {
      parts.push(esc(String(snippet).slice(i)));
      break;
    }
    parts.push(esc(String(snippet).slice(i, idx)));
    parts.push('<mark>' + esc(String(snippet).slice(idx, idx + q.length)) + '</mark>');
    i = idx + q.length;
  }
  return parts.join('');
}

function ctxStyle(ratio) {
  const v = Math.max(0, Math.min(100, Number(ratio) || 0));
  const color = v >= 90 ? 'var(--red)' : v >= 70 ? 'var(--amber)' : 'var(--accent)';
  return { width: Math.max(v, 2) + '%', background: color };
}

async function openDetail(s) {
  const request = ++detailRequest;
  detailLoading.value = true;
  detail.value = { ...s, loadError: '', summary: s.summary || { calls: s.calls, failed: s.failed, tokens: s.tokens, cost: s.cost, models: [], first_at: s.first_at, last_at: s.last_at }, messages: [] };
  try {
    const d = await fetchSessionDetail(s.session_id, s.source);
    if (request === detailRequest) detail.value = d;
  } catch (e) {
    if (request === detailRequest && detail.value) detail.value.loadError = e.message;
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
}

function closeDetail() {
  detailRequest++;
  detailLoading.value = false;
  detail.value = null;
}

function roleLabel(role) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return '助手';
  return role;
}

function fmtMsgTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<style scoped>
.session-row { cursor: pointer; }
.ss-search {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.ss-search-input {
  flex: 1;
  min-width: 220px;
  background: var(--bg-0);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.ss-search-input:focus { border-color: var(--accent); }
.ss-search-input::placeholder { color: var(--text-faint); }
.ss-search-days {
  background: var(--bg-0);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
  cursor: pointer;
}
.ss-search-days option { background: var(--bg-0); }
.ss-search-btn { flex-shrink: 0; }
.ss-search-error { color: var(--red); font-size: 11.5px; margin-bottom: 8px; }
.ss-search-meta { font-size: 11px; color: var(--text-faint); margin-bottom: 6px; }
.ss-result-wrap { max-height: 280px; margin-bottom: 14px; }
.ss-snippet {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-sub);
  font-size: 11.5px;
}
.ss-snippet :deep(mark) {
  background: transparent;
  color: var(--amber);
  font-weight: 600;
  padding: 0;
}
.sub-mark {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 400;
  color: var(--text-faint);
  border: 1px solid var(--card-border);
  border-radius: 3px;
  padding: 0 4px;
  cursor: help;
  vertical-align: 1px;
}
.ctx-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
  min-width: 90px;
}
.ctx-bar {
  width: 48px;
  height: 6px;
  border-radius: 3px;
  background: var(--border-subtle);
  overflow: hidden;
}
.ctx-fill { height: 100%; border-radius: 3px; }
.ctx-text { font-size: 10.5px; color: var(--text-sub); min-width: 38px; text-align: right; }
.detail-btn {
  border: 1px solid var(--card-border);
  background: var(--bg-0);
  color: var(--text-sub);
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.detail-btn:hover { border-color: var(--accent); color: var(--accent); }

/* 详情弹窗：与设置弹窗同风格（扁平边框，无阴影无渐变） */
.sd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.sd-modal {
  width: 760px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
}
.sd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
  font-weight: 600;
}
.sd-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sd-close {
  border: none;
  background: transparent;
  color: var(--text-sub);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  flex-shrink: 0;
}
.sd-close:hover { color: var(--text-main); background: var(--border-subtle); }
.sd-body { padding: 12px 16px 16px; overflow-y: auto; }
.sd-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--text-sub);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 10px;
}
.sd-meta-item { white-space: nowrap; }
.sd-msgs { display: flex; flex-direction: column; gap: 10px; }
.sd-msg {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--bg-0);
}
.sd-msg.user { border-left: 3px solid var(--border-subtle); }
.sd-msg.assistant { border-left: 3px solid var(--accent); }
.sd-msg-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-sub);
  margin-bottom: 4px;
}
.sd-msg-time { font-weight: 400; color: var(--text-faint); margin-left: 8px; }
.sd-part {
  font-size: 12px;
  color: var(--text-main);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  max-height: 180px;
  overflow-y: auto;
}
.sd-part.tool, .sd-part.meta { color: var(--text-faint); font-size: 11.5px; }
.sd-more { text-align: center; color: var(--text-faint); font-size: 11px; margin-top: 10px; }
</style>
