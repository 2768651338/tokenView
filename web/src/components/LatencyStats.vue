<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>延迟分析</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        仅统计带延迟数据的调用 · 近 {{ days === 'all' ? '全部' : days + ' 天' }}
      </span>
    </div>
    <template v-if="data.overall && data.overall.calls > 0">
      <div class="lat-overall">
        <div class="lat-kpi">
          <div class="lat-kpi-label">P50</div>
          <div class="lat-kpi-value">{{ fmtLatency(data.overall.p50) }}</div>
        </div>
        <div class="lat-kpi">
          <div class="lat-kpi-label">P95</div>
          <div class="lat-kpi-value">{{ fmtLatency(data.overall.p95) }}</div>
        </div>
        <div class="lat-kpi">
          <div class="lat-kpi-label">均值</div>
          <div class="lat-kpi-value">{{ fmtLatency(data.overall.avg) }}</div>
        </div>
        <div class="lat-kpi">
          <div class="lat-kpi-label">样本</div>
          <div class="lat-kpi-value">{{ fmtNum(data.overall.calls) }}</div>
        </div>
      </div>
      <div class="table-wrap" style="max-height:220px;">
        <table class="usage-table">
          <thead>
            <tr>
              <th>渠道</th>
              <th style="text-align:right;">调用</th>
              <th style="text-align:right;">P50</th>
              <th style="text-align:right;">P95</th>
              <th style="text-align:right;">均值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in data.channels" :key="c.channel">
              <td><span class="chip">{{ c.channel }}</span></td>
              <td style="text-align:right;">{{ fmtNum(c.calls) }}</td>
              <td style="text-align:right;">{{ fmtLatency(c.p50) }}</td>
              <td style="text-align:right;font-weight:600;">{{ fmtLatency(c.p95) }}</td>
              <td style="text-align:right;color:var(--text-sub);">{{ fmtLatency(c.avg) }}</td>
            </tr>
            <tr v-if="!(data.channels || []).length">
              <td colspan="5" style="text-align:center;color:var(--text-faint);padding:16px;">暂无分渠道数据</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 首字延迟（TTFT）：衡量首包等待，与总耗时相互独立 -->
      <template v-if="ttft && ttft.overall && ttft.overall.calls > 0">
        <div class="lat-ttft-title">首字延迟（TTFT · ZCode）</div>
        <div class="lat-overall">
          <div class="lat-kpi">
            <div class="lat-kpi-label">P50</div>
            <div class="lat-kpi-value">{{ fmtLatency(ttft.overall.p50) }}</div>
          </div>
          <div class="lat-kpi">
            <div class="lat-kpi-label">P95</div>
            <div class="lat-kpi-value">{{ fmtLatency(ttft.overall.p95) }}</div>
          </div>
          <div class="lat-kpi">
            <div class="lat-kpi-label">均值</div>
            <div class="lat-kpi-value">{{ fmtLatency(ttft.overall.avg) }}</div>
          </div>
          <div class="lat-kpi">
            <div class="lat-kpi-label">样本</div>
            <div class="lat-kpi-value">{{ fmtNum(ttft.overall.calls) }}</div>
          </div>
        </div>
        <div v-if="(ttft.channels || []).length" class="table-wrap" style="max-height:150px;">
          <table class="usage-table">
            <thead>
              <tr>
                <th>渠道</th>
                <th style="text-align:right;">样本</th>
                <th style="text-align:right;">P50</th>
                <th style="text-align:right;">P95</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in ttft.channels" :key="c.channel">
                <td><span class="chip">{{ c.channel }}</span></td>
                <td style="text-align:right;">{{ fmtNum(c.calls) }}</td>
                <td style="text-align:right;">{{ fmtLatency(c.p50) }}</td>
                <td style="text-align:right;">{{ fmtLatency(c.p95) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
    <div v-else style="text-align:center;color:var(--text-faint);font-size:12px;padding:36px 0;">
      所选范围内没有带延迟数据的调用（部分工具不提供延迟字段）
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { fmtLatency, fmtNum } from '../utils/format';

const props = defineProps({
  data: { type: Object, default: () => ({ overall: null, channels: [] }) },
  days: { type: [Number, String], default: 30 }
});

const ttft = computed(() => props.data.ttft || null);
</script>

<style scoped>
.lat-overall {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.lat-kpi {
  background: var(--bg-0);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 10px;
}
.lat-kpi-label { font-size: 10px; color: var(--text-faint); }
.lat-kpi-value {
  font-size: 15px;
  font-weight: 600;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.lat-ttft-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-sub);
  margin: 14px 0 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
</style>
