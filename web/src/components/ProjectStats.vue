<template>
  <div class="panel">
    <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>项目消耗</span>
      <span style="font-size:11px;color:var(--text-faint);font-weight:400;letter-spacing:0;">
        来自会话日志的项目目录 · 其余工具不区分项目
      </span>
    </div>
    <div class="table-wrap" style="max-height:280px;">
      <table class="usage-table">
        <thead>
          <tr>
            <th>项目</th>
            <th style="text-align:right;">Tokens</th>
            <th style="text-align:right;">占比</th>
            <th style="text-align:right;">调用</th>
            <th v-if="hasDiff" style="text-align:right;">代码增删</th>
            <th style="text-align:right;">费用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.id">
            <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;" :title="p.project">{{ p.project }}</td>
            <td style="text-align:right;font-weight:600;">{{ fmtTokens(p.tokens) }}</td>
            <td style="text-align:right;">
              <div class="ratio-wrap">
                <div class="ratio-bar" :style="{ width: ratioWidth(p.ratio) }"></div>
                <span class="ratio-text">{{ p.ratio }}%</span>
              </div>
            </td>
            <td style="text-align:right;color:var(--text-sub);">{{ fmtNum(p.calls) }}</td>
            <td v-if="hasDiff" style="text-align:right;">
              <template v-if="p.additions != null || p.deletions != null">
                <span style="color:var(--green);">+{{ fmtNum(p.additions || 0) }}</span>
                <span style="color:var(--red);margin-left:4px;">-{{ fmtNum(p.deletions || 0) }}</span>
              </template>
              <span v-else style="color:var(--text-faint);">—</span>
            </td>
            <td style="text-align:right;color:var(--amber);">{{ fmtCost(p.cost) }}</td>
          </tr>
          <tr v-if="!list.length">
            <td :colspan="hasDiff ? 6 : 5" style="text-align:center;color:var(--text-faint);padding:24px;">暂无带项目信息的数据</td>
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
  list: { type: Array, default: () => [] }
});

// 仅当存在任一增删数据时才展示该列（ZCode 部分会话未落 summary 值）
const hasDiff = computed(() => props.list.some((p) => p.additions != null || p.deletions != null));

function ratioWidth(r) {
  const v = Math.max(0, Math.min(100, Number(r) || 0));
  return Math.max(v, 2) + '%';
}
</script>

<style scoped>
.ratio-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.ratio-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--accent);
  opacity: 0.55;
  min-width: 4px;
}
.ratio-text {
  font-size: 11px;
  color: var(--text-sub);
  min-width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
