<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>工具统计</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        覆盖 13 个本地 code 工具 · 无本地数据源的通过上报接口统计
      </span>
    </div>
    <div class="table-wrap" style="max-height:360px;">
      <table class="usage-table">
        <thead>
          <tr>
            <th>工具</th>
            <th>状态</th>
            <th style="text-align:right;">调用次数</th>
            <th style="text-align:right;">Tokens</th>
            <th style="text-align:right;">费用</th>
            <th>最近使用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tools" :key="t.id">
            <td style="font-weight:600;">{{ t.name }}</td>
            <td><span class="tag" :class="statusClass(t.status)">{{ t.status }}</span></td>
            <td style="text-align:right;">{{ fmtNum(t.calls) }}</td>
            <td style="text-align:right;font-weight:600;">{{ fmtTokens(t.tokens) }}</td>
            <td style="text-align:right;color:var(--amber);">{{ fmtCost(t.cost) }}</td>
            <td style="color:var(--text-sub);">{{ t.last_used || '—' }}</td>
          </tr>
          <tr v-if="!tools.length">
            <td colspan="6" style="text-align:center;color:var(--text-faint);padding:24px;">加载中...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';

defineProps({
  tools: { type: Array, default: () => [] }
});

function statusClass(s) {
  if (s === '有数据') return 'tag-ok';
  if (s === '解密失败') return 'tag-fail';
  return 'tag-pending';
}
</script>

<style scoped>
.tag-pending { color: var(--text-sub); background: rgba(139, 150, 173, 0.12); }
</style>
