<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>模型市场价参考</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        {{ meta.note || '' }}
      </span>
    </div>
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
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.id">
            <td style="font-weight:600;">{{ p.model }}</td>
            <td><span class="chip">{{ p.channel }}</span></td>
            <td style="text-align:right;color:var(--accent);">¥{{ p.input_per_million }}<span class="unit">/百万</span></td>
            <td style="text-align:right;color:var(--accent-2);">¥{{ p.output_per_million }}<span class="unit">/百万</span></td>
            <td style="text-align:right;">{{ fmtTokens(p.tokens) }}</td>
            <td style="text-align:right;color:var(--amber);font-weight:600;">{{ fmtCost(p.cost) }}</td>
            <td style="text-align:right;color:var(--text-sub);">{{ fmtNum(p.calls) }}</td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="7" style="text-align:center;color:var(--text-faint);padding:24px;">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { fmtTokens, fmtCost, fmtNum } from '../utils/format';

const props = defineProps({
  data: { type: Object, default: () => ({ list: [], note: '', currency: '' }) }
});

const list = computed(() => props.data.list || []);
const meta = computed(() => props.data);
</script>

<style scoped>
.unit { font-size: 10px; color: var(--text-faint); margin-left: 2px; }
</style>
