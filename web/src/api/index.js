import axios from 'axios';

const http = axios.create({
  baseURL: '/api',
  timeout: 15000
});

http.interceptors.response.use(
  (res) => {
    if (res.data && res.data.code === 0) return res.data.data;
    return Promise.reject(new Error((res.data && res.data.message) || '接口错误'));
  },
  (err) => Promise.reject(err)
);

/** 核心 KPI 汇总 */
export const fetchOverview = (days) => http.get('/stats/overview', { params: { days } });
/** 时间趋势 */
export const fetchTrend = (params) => http.get('/stats/trend', { params });
/** 渠道维度统计 */
export const fetchChannels = (days) => http.get('/stats/channels', { params: { days } });
/** 模型 Top 排行 */
export const fetchModels = (days, limit = 10) => http.get('/stats/models', { params: { days, limit } });
/** 模型市场价参考 */
export const fetchPrices = () => http.get('/stats/prices');
/** 保存自定义模型单价（元 / 1K tokens，覆盖默认价或新增模型） */
export const saveModelPrice = (model, input, output) => http.post('/stats/prices', { model, input, output });
/** 恢复模型默认单价（删除自定义覆盖） */
export const resetModelPrice = (model) => http.post('/stats/prices/reset', { model });
/** 从 ModelRadar 同步在线价目（USD 按汇率换算为元） */
export const syncModelRadarPrices = () => http.post('/stats/prices/sync-modelradar');
/** 工具统计（13 个 code 工具） */
export const fetchTools = () => http.get('/stats/tools');
/** 用量明细分页 */
export const fetchUsage = (params) => http.get('/stats/usage', { params });
/** 渠道列表 */
export const fetchChannelList = () => http.get('/channels');
/** 时段热力图（星期 × 小时） */
export const fetchHeatmap = (days) => http.get('/stats/heatmap', { params: { days } });
/** 延迟分析（P50 / P95 / 均值） */
export const fetchLatency = (days) => http.get('/stats/latency', { params: { days } });
/** 项目维度统计 */
export const fetchProjects = (days, limit = 15) => http.get('/stats/projects', { params: { days, limit } });
/** 有数据的月份列表 */
export const fetchBillMonths = () => http.get('/stats/bill/months');
/** 月度账单 */
export const fetchBill = (month) => http.get('/stats/bill', { params: { month } });
/** 预算配置与当前状态 */
export const fetchBudget = () => http.get('/stats/budget');
/** 保存预算配置 */
export const saveBudget = (daily, monthly, enabled) => http.post('/stats/budget', { daily, monthly, enabled });
/** 数据源健康 */
export const fetchHealth = () => http.get('/stats/health');
/** 会话维度统计（ZCode / Claude Code / Codex） */
export const fetchSessions = (days, limit = 20) => http.get('/stats/sessions', { params: { days, limit } });
/** 会话详情（用量汇总 + ZCode 消息预览） */
export const fetchSessionDetail = (sessionId, source) => http.get('/stats/session/detail', { params: { session_id: sessionId, source } });
/** 错误与中断分析 */
export const fetchErrors = (days) => http.get('/stats/errors', { params: { days } });
/** 真实工具调用统计（ZCode tool_usage） */
export const fetchToolUsage = (days, limit = 30) => http.get('/stats/tool-usage', { params: { days, limit } });
/** 应用设置（汇率覆盖 / ZCode 数据位置等） */
export const fetchSettings = () => http.get('/stats/settings');
/** 保存汇率覆盖（null/空串表示清除覆盖） */
export const saveFxRate = (rate) => http.post('/stats/settings/fx', { rate });
/** 设置 ZCode 数据目录（'' 表示恢复默认 ~/.zcode） */
export const saveZcodeDir = (dir) => http.post('/stats/settings/zcode-dir', { dir });
/** 明细导出（blob 下载；独立于响应拦截器） */
export const downloadUsageExport = (params) => axios.get('/api/stats/usage/export', {
  params,
  responseType: 'blob',
  timeout: 120000
});
