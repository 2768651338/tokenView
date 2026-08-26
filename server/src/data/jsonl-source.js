'use strict';
/**
 * 增量 JSONL 扫描器：按文件记录已读字节偏移与 mtime，
 * 只解析追加的字节；文件被截断/替换/删除时自动全量重建。
 * Claude Code / Codex / WorkBuddy / LobsterAI 等会话目录数据源共用。
 *
 * 用法：
 *   const src = createJsonlSource({
 *     collectFiles(root) -> string[],           // 列出待扫描的 .jsonl 绝对路径
 *     createFileState() -> S,                   // 每文件解析上下文（跨行状态），全量重读时重建
 *     reduceLine(state, obj, meta, emit)        // 处理一行已解析的 JSON；meta={file,lineNo}
 *   });
 *   src.refresh(root);                          // 同步扫描一次（增量时开销极小）
 *   src.getRecords();                           // 累积的全部记录
 */
const fs = require('fs');

const NL = 0x0A;

function createJsonlSource({ collectFiles, createFileState, reduceLine }) {
  /** file -> { size, mtimeMs, tail:Buffer|null, state, lineCount } */
  const metas = new Map();
  let records = [];

  /**
   * 处理一行；retainOnFail 时解析失败返回 false（调用方保留半行缓冲等待补全），
   * 其余情况返回 true（空行或坏行直接丢弃）。
   */
  function handleLine(meta, file, lineBuf, retainOnFail) {
    const lineNo = meta.lineCount++;
    const text = lineBuf.toString('utf8').trim();
    if (!text) return true;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return !retainOnFail;
    }
    reduceLine(meta.state, obj, { file, lineNo }, (row) => { if (row) records.push(row); });
    return true;
  }

  /** 扫描单个文件：无变化跳过；仅增长则读追加段；其余异常由外层触发全量重建 */
  function scanFile(file, meta) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return false; // 读取中文件消失 → 视为异常，交外层全量重建
    }
    const known = typeof meta.size === 'number';
    const grew = known && st.size > meta.size;
    if (known && st.size === meta.size) {
      // 尺寸未变：mtime 也相同则无变化；否则文件被同尺寸改写 → 异常，交外层全量重建
      return st.mtimeMs === meta.mtimeMs;
    }

    const fromOffset = grew ? meta.size : 0;
    const fh = fs.openSync(file, 'r');
    let chunk;
    try {
      const len = st.size - fromOffset;
      const buf = Buffer.alloc(len);
      let off = 0;
      while (off < len) {
        const n = fs.readSync(fh, buf, off, len - off, fromOffset + off);
        if (n <= 0) break;
        off += n;
      }
      chunk = buf.subarray(0, off);
    } finally {
      fs.closeSync(fh);
    }

    const data = grew && meta.tail && meta.tail.length ? Buffer.concat([meta.tail, chunk]) : chunk;
    let lineStart = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === NL) {
        handleLine(meta, file, data.subarray(lineStart, i), false);
        lineStart = i + 1;
      }
    }
    meta.tail = lineStart < data.length ? Buffer.from(data.subarray(lineStart)) : null;
    // 文件已停止增长但末尾没有换行：尝试按最后一行消费（能完整解析才消费，否则留待下轮）
    if (!grew && meta.tail && meta.tail.length) {
      if (handleLine(meta, file, meta.tail, true)) meta.tail = null;
    }
    meta.size = st.size;
    meta.mtimeMs = st.mtimeMs;
    return true;
  }

  /** 全量重建：清空全部状态后重新扫描所有文件 */
  function rebuildAll(files) {
    metas.clear();
    records = [];
    for (const file of files) {
      const meta = { size: undefined, mtimeMs: 0, tail: null, state: createFileState(), lineCount: 0 };
      metas.set(file, meta);
      if (!scanFile(file, meta)) metas.delete(file);
    }
  }

  return {
    /** 同步扫描一轮；任何文件缺失/截断都会触发整体全量重建 */
    refresh(root) {
      let files;
      try {
        files = collectFiles(root);
      } catch {
        files = [];
      }
      // 预检：已知文件是否仍存在且未截断（存在任一异常则放弃增量路径）
      let healthy = true;
      for (const [file, meta] of metas) {
        let st = null;
        try {
          st = fs.statSync(file);
        } catch { /* 文件消失 */ }
        if (!st || st.size < meta.size) { healthy = false; break; }
      }
      if (!healthy) {
        rebuildAll(files);
        return;
      }
      const seen = new Set(files);
      for (const file of files) {
        let meta = metas.get(file);
        if (!meta) {
          meta = { size: undefined, mtimeMs: 0, tail: null, state: createFileState(), lineCount: 0 };
          metas.set(file, meta);
        }
        // 同尺寸改写等异常无法增量处理 → 全量重建
        if (!scanFile(file, meta)) {
          rebuildAll(files);
          return;
        }
      }
      // 已消失的文件：其记录无法单独摘除，走全量重建
      for (const file of metas.keys()) {
        if (!seen.has(file)) { rebuildAll(files); return; }
      }
    },
    getRecords() {
      return records;
    }
  };
}

module.exports = { createJsonlSource };
