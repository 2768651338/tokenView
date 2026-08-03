<template>
  <div class="panel">
    <div class="panel-title">渠道消耗排行榜</div>
    <div class="rank-list">
      <div v-for="(c, i) in channels" :key="c.id" class="rank-item">
        <div class="rank-no" :class="[i < 3 ? 'top n' + (i + 1) : '']">{{ i + 1 }}</div>
        <div class="rank-info">
          <div class="rank-name">{{ c.name }}</div>
          <div class="rank-meta">{{ c.provider }} · {{ c.model_count }} 个模型</div>
        </div>
        <div class="rank-val">
          <b>{{ fmtTokens(c.tokens) }}</b>
          <span>{{ c.ratio }}% · {{ fmtCost(c.cost) }}</span>
        </div>
      </div>
      <div v-if="!channels.length" class="loading-mask">
        <span class="spinner"></span> 加载中...
      </div>
    </div>
  </div>
</template>

<script setup>
import { fmtTokens, fmtCost } from '../utils/format';

defineProps({
  channels: { type: Array, default: () => [] }
});
</script>
