<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>工具调用分析</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        ZCode 真实调用记录 · 近 {{ days === 'all' ? '全部' : days + ' 天' }}
      </span>
    </div>
    <div v-if="list.length" class="table-wrap" style="max-height:300px;">
      <table class="usage-table">
        <thead>
          <tr>
            <th>工具</th>
            <th style="text-align:right;">调用</th>
            <th style="text-align:right;">失败</th>
            <th style="text-align:right;">失败率</th>
            <th style="text-align:right;">平均耗时</th>
            <th style="text-align:right;">只读</th>
            <th style="text-align:right;">破坏性</th>
            <th>最近使用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in list" :key="t.tool">
            <td style="font-weight:600;">
              {{ t.tool }}
              <span v-if="t.running" class="run-mark" title="当前正在执行">运行中 {{ t.running }}</span>
            </td>
            <td style="text-align:right;">{{ fmtNum(t.calls) }}</td>
            <td style="text-align:right;" :style="t.errors ? 'color:var(--red);' : 'color:var(--text-faint);'">{{ t.errors || '—' }}</td>
            <td style="text-align:right;">{{ failRate(t) }}%</td>
            <td style="text-align:right;">{{ fmtLatency(t.avg_ms) }}</td>
            <td style="text-align:right;color:var(--text-sub);">{{ t.readonly_calls ? fmtNum(t.readonly_calls) : '—' }}</td>
            <td style="text-align:right;" :style="t.destructive_calls ? 'color:var(--amber);' : 'color:var(--text-faint);'">
              {{ t.destructive_calls || '—' }}
            </td>
            <td style="color:var(--text-sub);">{{ fmtTime(t.last_used) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else style="text-align:center;color:var(--text-faint);font-size:12px;padding:32px 0;">
      所选范围内没有工具调用记录（该数据来自 ZCode tool_usage 表）
    </div>
  </div>
</template>

<script setup>
import { fmtNum, fmtLatency } from '../utils/format';

defineProps({
  list: { type: Array, default: () => [] },
  days: { type: [Number, String], default: 30 }
});

function failRate(t) {
  if (!t.calls) return '0';
  return ((t.errors / t.calls) * 100).toFixed(1);
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<style scoped>
.run-mark {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 400;
  color: var(--green);
  border: 1px solid var(--card-border);
  border-radius: 3px;
  padding: 0 4px;
}
</style>
