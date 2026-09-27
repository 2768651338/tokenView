<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>错误与中断</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        近 {{ days === 'all' ? '全部' : days + ' 天' }}
      </span>
    </div>
    <template v-if="data && data.calls > 0">
      <div class="err-kpis">
        <div class="err-kpi">
          <div class="err-kpi-label">失败率</div>
          <div class="err-kpi-value" :style="data.failure_rate >= 5 ? 'color:var(--red);' : data.failure_rate >= 1 ? 'color:var(--amber);' : ''">
            {{ data.failure_rate }}%
          </div>
        </div>
        <div class="err-kpi">
          <div class="err-kpi-label">失败调用</div>
          <div class="err-kpi-value">{{ fmtNum(data.failed) }}</div>
        </div>
        <div class="err-kpi">
          <div class="err-kpi-label">错误事件</div>
          <div class="err-kpi-value">{{ fmtNum(data.error_events) }}</div>
        </div>
        <div class="err-kpi">
          <div class="err-kpi-label">用户中断</div>
          <div class="err-kpi-value">{{ fmtNum(data.cancelled) }}</div>
        </div>
        <div class="err-kpi">
          <div class="err-kpi-label">重试调用</div>
          <div class="err-kpi-value">{{ fmtNum(data.retry_calls) }}</div>
        </div>
        <div class="err-kpi">
          <div class="err-kpi-label">上下文超限</div>
          <div class="err-kpi-value">{{ fmtNum(data.context_exceeded) }}</div>
        </div>
      </div>
      <div v-if="data.error_events || data.failed" class="table-wrap" style="max-height:190px;">
        <table class="usage-table">
          <thead>
            <tr>
              <th>错误类型</th>
              <th style="text-align:right;">次数</th>
              <th>最近发生</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in data.by_type" :key="t.name">
              <td><span class="chip">{{ t.name }}</span></td>
              <td style="text-align:right;font-weight:600;">{{ fmtNum(t.count) }}</td>
              <td style="color:var(--text-sub);">{{ t.last_at }}</td>
            </tr>
            <tr v-if="!(data.by_type || []).length">
              <td colspan="3" style="text-align:center;color:var(--text-faint);padding:14px;">无失败记录</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="failedChannels.length" class="err-channels">
        <span class="err-channels-label">渠道失败：</span>
        <span v-for="c in failedChannels" :key="c.name" class="err-channel" :title="`${c.calls} 次调用中失败 ${c.failed} 次（${c.failure_rate}%）`">
          {{ c.name }} {{ c.failed }}/{{ c.calls }}
        </span>
      </div>
    </template>
    <div v-else style="text-align:center;color:var(--text-faint);font-size:12px;padding:32px 0;">
      所选范围内没有调用记录
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { fmtNum } from '../utils/format';

const props = defineProps({
  data: { type: Object, default: () => ({}) },
  days: { type: [Number, String], default: 30 }
});

const failedChannels = computed(() => (props.data.by_channel || []).filter((c) => c.failed > 0).slice(0, 5));
</script>

<style scoped>
.err-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.err-kpi {
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 10px;
}
.err-kpi-label { font-size: 10px; color: var(--text-faint); }
.err-kpi-value {
  font-size: 15px;
  font-weight: 600;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.err-channels {
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.err-channels-label { color: var(--text-faint); }
.err-channel {
  border: 1px solid var(--card-border);
  border-radius: 4px;
  padding: 1px 8px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
