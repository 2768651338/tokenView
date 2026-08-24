<template>
  <div class="panel">
    <div class="panel-title">调用明细</div>

    <div class="filter-row">
      <select v-model="filters.channel" @change="onFilterChange">
        <option value="">全部渠道</option>
        <option v-for="c in channelList" :key="c.id" :value="c.name">{{ c.name }}</option>
      </select>
      <select v-model="filters.source" @change="onFilterChange">
        <option value="">全部来源</option>
        <option v-for="s in sourceOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <select v-model="filters.status" @change="onFilterChange">
        <option value="">全部状态</option>
        <option value="1">成功</option>
        <option value="0">失败</option>
      </select>
      <input type="date" v-model="filters.start" @change="onFilterChange" title="开始日期" />
      <span style="color:var(--text-faint);align-self:center;">至</span>
      <input type="date" v-model="filters.end" @change="onFilterChange" title="结束日期" />
      <button class="pager-btn" @click="refresh">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="usage-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>渠道</th>
            <th>模型</th>
            <th style="text-align:right;">输入</th>
            <th style="text-align:right;">输出</th>
            <th style="text-align:right;">总量</th>
            <th style="text-align:right;">费用</th>
            <th style="text-align:right;">延迟</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in list" :key="r.id">
            <td style="color:var(--text-sub);">{{ r.created_at }}</td>
            <td><span class="chip">{{ r.channel }}</span></td>
            <td>{{ r.model }}</td>
            <td style="text-align:right;">{{ fmtNum(r.prompt_tokens) }}</td>
            <td style="text-align:right;">{{ fmtNum(r.completion_tokens) }}</td>
            <td style="text-align:right;font-weight:600;">{{ fmtNum(r.total_tokens) }}</td>
            <td style="text-align:right;color:var(--amber);">¥{{ Number(r.cost).toFixed(4) }}</td>
            <td style="text-align:right;color:var(--text-sub);">{{ fmtLatency(r.latency_ms) }}</td>
            <td>
              <span class="tag" :class="r.status === 1 ? 'tag-ok' : 'tag-fail'">
                {{ r.status === 1 ? '成功' : '失败' }}
              </span>
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="9" style="text-align:center;color:var(--text-faint);padding:28px;">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager">
      <span>共 {{ total.toLocaleString('zh-CN') }} 条</span>
      <span>
        <button :disabled="page <= 1" @click="$emit('page-change', page - 1)">上一页</button>
        <span style="margin:0 12px;">{{ page }} / {{ pageCount }}</span>
        <button :disabled="page >= pageCount" @click="$emit('page-change', page + 1)">下一页</button>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue';
import { fmtNum, fmtLatency } from '../utils/format';

const props = defineProps({
  list: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
  channelList: { type: Array, default: () => [] },
  sourceOptions: { type: Array, default: () => [] }
});
const emit = defineEmits(['page-change', 'filter-change', 'refresh']);

const filters = reactive({ channel: '', source: '', status: '', start: '', end: '' });

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

function onFilterChange() {
  emit('filter-change', { ...filters });
}
function refresh() {
  emit('refresh');
}
</script>

<style scoped>
.pager-btn {
  border: 1px solid var(--card-border);
  background: var(--bg-0);
  color: var(--text-main);
  border-radius: 4px;
  padding: 4px 14px;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
}
.pager-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
