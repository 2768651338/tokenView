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
