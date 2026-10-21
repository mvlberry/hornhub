export const MAX_ROM_BYTES = 8 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 1024 * 1024;

export function validateRom(bytes) {
  if (bytes.byteLength > MAX_ROM_BYTES) throw new Error('ROM 不能超过 8 MB。');
  if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw new Error('文件格式不正确，请选择未压缩的 iNES 格式 .nes 文件。');
  }
  if ((bytes[7] & 0x0c) === 0x08) throw new Error('暂不支持 NES 2.0，请使用 iNES 格式的 ROM。');
  if (!bytes[4]) throw new Error('ROM 缺少程序数据。');
  const expected = 16 + (bytes[6] & 4 ? 512 : 0) + bytes[4] * 16384 + bytes[5] * 8192;
  if (bytes.length < expected) throw new Error('ROM 数据不完整，请重新选择文件。');
  return bytes;
}

export function romURL(path, base) {
  if (!path || !path.trim()) throw new Error('这盘卡带还没有配置 ROM。');
  const url = new URL(path, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== new URL(base).origin || url.username || url.password || !/\.nes$/i.test(url.pathname)) {
    throw new Error('游戏路径必须是本站的 .nes 文件。');
  }
  return url.href;
}

export function romDirectoryURL(path, base) {
  const url = new URL(path, base);
  if (!path || !['https:', 'http:'].includes(url.protocol) || url.origin !== new URL(base).origin || url.username || url.password || !url.pathname.endsWith('/') || url.search || url.hash) {
    throw new Error('游戏列表地址必须是本站目录。');
  }
  return url.href;
}

export function parseRomDirectory(entries, directory, base) {
  if (!Array.isArray(entries)) throw new Error('游戏列表暂不可用，请稍后刷新。');
  const directoryURL = romDirectoryURL(directory, base);
  const seen = new Set();
  const games = [];
  for (const entry of entries) {
    if (!entry || entry.type !== 'file' || typeof entry.name !== 'string' || entry.name.startsWith('.') || !/\.nes$/i.test(entry.name) || /[\u0000-\u001f\u007f-\u009f/\\]/.test(entry.name)) continue;
    if (!Number.isSafeInteger(entry.size) || entry.size < 16 || entry.size > MAX_ROM_BYTES) continue;
    const title = entry.name.replace(/\.nes$/i, '').trim();
    if (!title || title === '.' || title === '..' || seen.has(entry.name)) continue;
    let url;
    try { url = romURL(encodeURIComponent(entry.name), directoryURL); }
    catch { continue; }
    seen.add(entry.name);
    games.push({ title, url, size: entry.size });
  }
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  return games.sort((a, b) => collator.compare(a.title, b.title));
}

async function readBoundedBytes(response, limit, tooLargeMessage) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error(tooLargeMessage);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(tooLargeMessage);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function readRomDirectoryResponse(response, directory, base) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('游戏列表暂不可用，请稍后刷新，也可以打开本地 ROM。');
  }
  const bytes = await readBoundedBytes(response, MAX_LIBRARY_BYTES, '游戏列表过大，请联系站长整理后重试。');
  let entries;
  try { entries = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('游戏列表暂不可用，请稍后刷新，也可以打开本地 ROM。'); }
  return parseRomDirectory(entries, directory, base);
}

export function createRomLibrary({ directory, base, onChange, fetch: fetchRequest = globalThis.fetch, timeoutMs = 15000 }) {
  let revision = 0;
  let request = null;
  return {
    async refresh() {
      const sequence = ++revision;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      onChange({ state: 'loading', games: [] });
      try {
        const url = romDirectoryURL(directory, base);
        const response = await fetchRequest(url, { signal: controller.signal, mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
        const games = await readRomDirectoryResponse(response, url, base);
        if (sequence !== revision) return;
        if (controller.signal.aborted) throw new DOMException('Library reading aborted', 'AbortError');
        onChange({ state: games.length ? 'ready' : 'empty', games });
      } catch (error) {
        if (sequence !== revision) return;
        const message = timedOut ? '游戏列表加载超时，请刷新重试。' : error.name === 'TypeError' ? '无法读取游戏列表，请检查网络后刷新重试。' : error.message;
        onChange({ state: 'error', games: [], message });
      } finally {
        clearTimeout(timeout);
        if (sequence === revision) request = null;
      }
    },
    cancel() { ++revision; request?.abort(); request = null; },
  };
}

export async function readRomResponse(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 404 ? '找不到 ROM 文件，请检查游戏配置和上传路径。' : 'ROM 加载失败，请稍后重试。');
  }
  return validateRom(await readBoundedBytes(response, MAX_ROM_BYTES, 'ROM 不能超过 8 MB。'));
}
