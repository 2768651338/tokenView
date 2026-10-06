/**
 * 数据备份 / 恢复：数据目录中「用户产生的」文件打包为单个 JSON bundle 导出，
 * 导入时逐文件校验后原子写回，并重置各内存缓存使其立即生效。
 * 不含价目表默认值（prices.json 随程序分发）与任何工具原始数据（只读数据源，不属于本应用）。
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../runtime');
const reports = require('./reports');
const stats = require('./stats');

const BUNDLE_VERSION = 1;
/** 参与备份的文件清单（数据目录相对路径）；null 内容表示该文件当前不存在 */
const FILES = [
  'reports.jsonl',          // 上报数据
  'custom-prices.json',     // 自定义模型单价
  'budget.json',            // 预算配置
  'settings.json',          // 应用设置（汇率覆盖 / ZCode 位置 / Webhook / 订阅渠道 / 保留策略）
  'modelradar-prices.json'  // 在线价目快照
];
/** 必须是合法 JSON 的文件（jsonl 允许流式行） */
const JSON_FILES = new Set(['custom-prices.json', 'budget.json', 'settings.json', 'modelradar-prices.json']);
/** 单文件导入上限（reports.jsonl 长期积累可能较大） */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 导出 bundle：{ app, bundle_version, exported_at, files: { name: string|null } } */
function exportBundle() {
  const files = {};
  for (const name of FILES) {
    try {
      files[name] = fs.readFileSync(path.join(dataDir(), name), 'utf8');
    } catch {
      files[name] = null; // 文件不存在属正常（如从未同步过在线价）
    }
  }
  return {
    app: 'TokenView',
    bundle_version: BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    files
  };
}

/** 原子写文件：写临时文件后 rename，避免写一半崩溃损坏原文件 */
function atomicWrite(name, content) {
  const file = path.join(dataDir(), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 导入 bundle。
 * 防呆：未知文件跳过（不落盘）；JSON 文件必须可解析；单文件超限拒绝；
 * 恢复 settings.json 会覆盖当前全部应用设置（含 Webhook / 订阅渠道等），UI 层需二次确认。
 * @returns {{ imported: [{name, bytes}], skipped: [{name, reason}] }} 全部拒绝时抛错
 */
function importBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('备份文件结构不正确');
  }
  if (bundle.app !== 'TokenView' || !bundle.files || typeof bundle.files !== 'object') {
    throw new Error('这不是 TokenView 的备份文件（缺少 app/files 字段）');
  }
  const imported = [];
  const skipped = [];
  for (const [name, content] of Object.entries(bundle.files)) {
    if (!FILES.includes(name)) {
      skipped.push({ name, reason: '未知文件，已跳过' });
      continue;
    }
    if (content == null) {
      skipped.push({ name, reason: '备份中不存在该文件，已跳过' });
      continue;
    }
    if (typeof content !== 'string') {
      skipped.push({ name, reason: '内容格式异常，已跳过' });
      continue;
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      skipped.push({ name, reason: '超过单文件 200MB 上限，已跳过' });
      continue;
    }
    if (JSON_FILES.has(name)) {
      try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      } catch {
        skipped.push({ name, reason: '不是有效的 JSON 配置文件，已跳过' });
        continue;
      }
    }
    atomicWrite(name, content);
    imported.push({ name, bytes: Buffer.byteLength(content, 'utf8') });
  }
  if (!imported.length) {
    throw new Error(`没有任何文件被导入（${skipped.map((s) => `${s.name}：${s.reason}`).join('；')}）`);
  }
  // 内存缓存重置：reports 强制重读；stats 层费用重算；其余模块按 mtime 自动感知
  reports.reset();
  stats.invalidate();
  return { imported, skipped };
}

module.exports = { exportBundle, importBundle, FILES, BUNDLE_VERSION };
