/**
 * VS Code 系应用 secret storage 解密工具（v10t/v11 格式）
 * 流程：state.vscdb 的 ItemTable 取 secret 值（BLOB）→ Local State 的
 * os_crypt.encrypted_key（DPAPI 加密的 AES key）→ PowerShell DPAPI 解密 →
 * AES-256-GCM 解 v10t 密文。全部只读，best-effort。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

/** 用 PowerShell 调 DPAPI 解密（Windows ProtectedData） */
function dpapiUnprotect(encryptedBase64) {
  const script =
    `Add-Type -AssemblyName System.Security;` +
    `$b=[Convert]::FromBase64String('${encryptedBase64}');` +
    `$r=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser');` +
    `[Convert]::ToBase64String($r)`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 15000, windowsHide: true
  });
  return out.trim().split(/\r?\n/).pop();
}

/** 从 Local State 提取 AES key（Buffer 32 字节），失败返回 null */
function getAesKey(localStatePath) {
  try {
    const state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const enc = state.os_crypt && state.os_crypt.encrypted_key;
    if (!enc) return null;
    const raw = Buffer.from(enc, 'base64');
    const payload = raw.slice('DPAPI'.length);
    const keyBase64 = dpapiUnprotect(payload.toString('base64'));
    const key = Buffer.from(keyBase64, 'base64');
    return key.length === 32 ? key : null;
  } catch (e) {
    console.warn('[vscode-secret] 获取 AES key 失败:', e.message);
    return null;
  }
}

/** 解密 v10t/v11 BLOB，返回明文字符串，失败返回 null（依次尝试标准 3 字节与 4 字节前缀） */
function decryptSecret(valueBuffer, key) {
  try {
    if (!valueBuffer || !key || !Buffer.isBuffer(valueBuffer)) return null;
    for (const prefixLen of [3, 4]) {
      const buf = valueBuffer.slice(prefixLen);
      if (buf.length < 12 + 16) continue;
      const nonce = buf.subarray(0, 12);
      const tag = buf.subarray(buf.length - 16);
      const data = buf.subarray(12, buf.length - 16);
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      } catch { /* 该布局不匹配，尝试下一个 */ }
    }
    console.warn('[vscode-secret] 解密失败（所有布局均不匹配）');
    return null;
  } catch (e) {
    console.warn('[vscode-secret] 解密失败:', e.message);
    return null;
  }
}

/**
 * 完整读取流程：state.vscdb 中 key 含 keySubstring 的 secret 值解密为字符串
 * @param {string} vscdbPath state.vscdb 路径
 * @param {string} localStatePath Local State 路径
 * @param {string} keySubstring secret key 子串
 * @returns {string|null}
 */
function readSecret(vscdbPath, localStatePath, keySubstring) {
  if (!fs.existsSync(vscdbPath) || !fs.existsSync(localStatePath)) return null;
  const key = getAesKey(localStatePath);
  if (!key) return null;
  const db = new DatabaseSync(vscdbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key LIKE ? LIMIT 1')
      .get(`%${keySubstring}%`);
    if (!row) return null;
    // value 可能是 BLOB 或 JSON 字符串 {"type":"Buffer","data":[...]}
    let buf;
    if (Buffer.isBuffer(row.value)) {
      buf = row.value;
    } else if (typeof row.value === 'string') {
      try {
        const parsed = JSON.parse(row.value);
        buf = parsed && parsed.type === 'Buffer' && Array.isArray(parsed.data)
          ? Buffer.from(parsed.data)
          : Buffer.from(row.value);
      } catch {
        buf = Buffer.from(row.value);
      }
    } else {
      return null;
    }
    return decryptSecret(buf, key);
  } catch (e) {
    console.warn('[vscode-secret] 读取 secret 失败:', e.message);
    return null;
  } finally {
    db.close();
  }
}

module.exports = { readSecret, getAesKey, decryptSecret };
