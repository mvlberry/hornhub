const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let rom;
before(async () => { rom = await import('../assets/js/nes-rom.mjs'); });

// Original, synthetic NROM fixture. No third-party game data.
function fixture({ trainer = false, chr = 1, tone = false } = {}) {
  const bytes = new Uint8Array(16 + (trainer ? 512 : 0) + 16384 + chr * 8192);
  bytes.set([0x4e, 0x45, 0x53, 0x1a, 1, chr, trainer ? 4 : 0, 0]);
  const start = 16 + (trainer ? 512 : 0);
  const program = tone ? [
    0x78, 0xd8,
    0xa9, 0x01, 0x8d, 0x15, 0x40, // Enable pulse channel 1.
    0xa9, 0xbf, 0x8d, 0x00, 0x40, // Constant volume, length counter halt.
    0xa9, 0xfd, 0x8d, 0x02, 0x40, // Pulse timer.
    0xa9, 0x00, 0x8d, 0x03, 0x40,
  ] : [0x78, 0xd8];
  const loop = 0x8000 + program.length;
  program.push(0x4c, loop & 0xff, loop >> 8);
  bytes.set(program, start);
  bytes.set([0x00, 0x80, 0x00, 0x80, 0x00, 0x80], start + 16378);
  return bytes;
}

test('accepts complete iNES, CHR RAM and trainer ROMs', () => {
  for (const bytes of [fixture(), fixture({ chr: 0 }), fixture({ trainer: true })]) {
    assert.equal(rom.validateRom(bytes), bytes);
  }
});
test('rejects wrong magic, short headers, missing PRG and truncated data', () => {
  assert.throws(() => rom.validateRom(new Uint8Array(12)), /格式/);
  assert.throws(() => rom.validateRom(new Uint8Array(100)), /格式/);
  const empty = fixture(); empty[4] = 0;
  assert.throws(() => rom.validateRom(empty), /程序/);
  assert.throws(() => rom.validateRom(fixture().slice(0, -1)), /不完整/);
  const trainer = fixture(); trainer[6] = 4;
  assert.throws(() => rom.validateRom(trainer), /不完整/);
});
test('rejects NES 2.0 instead of treating it as legacy iNES', () => {
  const bytes = fixture(); bytes[7] = 8;
  assert.throws(() => rom.validateRom(bytes), /NES 2.0/);
});
test('enforces a bounded file size', () => {
  assert.throws(() => rom.validateRom(new Uint8Array(rom.MAX_ROM_BYTES + 1)), /8 MB/);
});
test('only accepts same-origin HTTP(S) .nes URLs', () => {
  const base = 'https://example.com/blog/games/';
  assert.equal(rom.romURL('/roms/one.nes', base), 'https://example.com/roms/one.nes');
  assert.equal(rom.romURL('../roms/two.NES?v=1', base), 'https://example.com/blog/roms/two.NES?v=1');
  for (const path of ['', '//evil.example/file.nes', 'https://evil.example/file.nes', 'javascript:alert(1)', 'data:application/octet-stream,rom', '/roms/game.zip', 'https://user:pass@example.com/a.nes']) {
    assert.throws(() => rom.romURL(path, base));
  }
});
test('reads and validates a bounded successful response', async () => {
  const bytes = fixture();
  const result = await rom.readRomResponse(new Response(bytes));
  assert.deepEqual(result, bytes);
});
test('rejects 404, declared oversize and streamed oversize responses', async () => {
  await assert.rejects(rom.readRomResponse(new Response('missing', { status: 404 })), /找不到/);
  await assert.rejects(rom.readRomResponse(new Response('oversized', { headers: { 'Content-Length': String(rom.MAX_ROM_BYTES + 1) } })), /8 MB/);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(rom.MAX_ROM_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  await assert.rejects(rom.readRomResponse(new Response(stream)), /8 MB/);
});

const libraryBase = 'https://example.com/blog/games/';
const libraryDirectory = '/blog/roms/';
const entry = (name, extra = {}) => ({ name, type: 'file', size: 24592, ...extra });
const listing = entries => new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } });

test('directory listing encodes complete file names and keeps titles as plain text', () => {
  const names = ['超级 马里奥 #1%.NES', 'game?mode=1.nes', '<script>alert(1)<.nes'];
  const games = rom.parseRomDirectory(names.map(name => entry(name)), libraryDirectory, libraryBase);
  assert.equal(games.length, names.length);
  for (const name of names) {
    const game = games.find(game => game.title === name.replace(/\.nes$/i, ''));
    assert(game);
    assert.equal(game.url, `https://example.com/blog/roms/${encodeURIComponent(name)}`);
    assert.equal(new URL(game.url).search, '');
    assert.equal(new URL(game.url).hash, '');
  }
});
test('directory listing only accepts bounded direct NES files and removes duplicate names', () => {
  const invalid = [
    entry('../escape.nes'), entry('..\\escape.nes'), entry('/absolute.nes'), entry('nested/game.nes'),
    entry('control\u0000.nes'), entry('control\u0085.nes'), entry('\ud800.nes'), entry('   .nes'),
    entry('.'), entry('..'), entry('..nes'), entry('...nes'), entry('.hidden.nes'), entry('game.zip'), entry('folder.nes', { type: 'directory' }),
    entry('small.nes', { size: 15 }), entry('large.nes', { size: rom.MAX_ROM_BYTES + 1 }),
    entry('negative.nes', { size: -1 }), entry('float.nes', { size: 32.5 }), entry('string.nes', { size: '100' }),
    null, {}, { name: 123, type: 'file', size: 100 },
  ];
  const games = rom.parseRomDirectory([...invalid, entry('Game 10.nes'), entry('Game 2.nes'), entry('Game 2.nes')], libraryDirectory, libraryBase);
  assert.deepEqual(games.map(game => game.title), ['Game 2', 'Game 10']);
  assert.deepEqual(rom.parseRomDirectory(invalid, libraryDirectory, libraryBase), []);
  assert.throws(() => rom.parseRomDirectory({ games: [] }, libraryDirectory, libraryBase), /暂不可用/);
});
test('directory requests require a same-origin HTTP directory without query or credentials', () => {
  assert.equal(rom.romDirectoryURL('../roms/', libraryBase), 'https://example.com/blog/roms/');
  for (const directory of ['', '//evil.example/roms/', 'https://evil.example/roms/', 'https://user:pass@example.com/roms/', '/roms', '/roms/?list=1', '/roms/#files', 'file:///roms/']) {
    assert.throws(() => rom.romDirectoryURL(directory, libraryBase));
  }
});
test('directory response distinguishes valid empty lists from HTTP and malformed listing errors', async () => {
  assert.deepEqual(await rom.readRomDirectoryResponse(listing([]), libraryDirectory, libraryBase), []);
  assert.equal((await rom.readRomDirectoryResponse(listing([entry('one.nes')]), libraryDirectory, libraryBase))[0].title, 'one');
  for (const response of [new Response('missing', { status: 404 }), new Response('<html>directory</html>'), listing({ games: [] }), new Response(Uint8Array.from([0xff]))]) {
    await assert.rejects(rom.readRomDirectoryResponse(response, libraryDirectory, libraryBase), /暂不可用/);
  }
});
test('directory response rejects declared and streamed oversize before parsing JSON', async () => {
  await assert.rejects(rom.readRomDirectoryResponse(new Response('[]', { headers: { 'Content-Length': String(rom.MAX_LIBRARY_BYTES + 1) } }), libraryDirectory, libraryBase), /列表过大/);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(rom.MAX_LIBRARY_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(rom.readRomDirectoryResponse(new Response(stream), libraryDirectory, libraryBase), /列表过大/);
  assert(cancelled, 'Expected the oversized listing stream to be cancelled');
});
test('library refresh replaces old requests and ignores stale success and failure', async () => {
  const requests = [], states = [];
  const library = rom.createRomLibrary({
    directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  });
  const old = library.refresh();
  const current = library.refresh();
  assert(requests[0].options.signal.aborted);
  assert.equal(requests[1].url, 'https://example.com/blog/roms/');
  assert.equal(requests[1].options.cache, 'no-store');
  assert.equal(requests[1].options.redirect, 'error');
  assert.equal(requests[1].options.mode, 'same-origin');
  requests[1].resolve(listing([entry('new.nes')]));
  await current;
  requests[0].resolve(listing([entry('old.nes')]));
  await old;
  assert.deepEqual(states.map(state => state.state), ['loading', 'loading', 'ready']);
  assert.equal(states.at(-1).games[0].title, 'new');

  const staleFailure = library.refresh();
  const empty = library.refresh();
  requests[3].resolve(listing([]));
  await empty;
  requests[2].reject(new Error('Old request failed'));
  await staleFailure;
  assert.equal(states.at(-1).state, 'empty');
  assert(!states.some(state => state.state === 'error'));
});
test('library refresh reports network errors and timeout, while cancellation stays quiet', async () => {
  const states = [];
  const network = rom.createRomLibrary({ directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state), fetch: async () => { throw new TypeError('Network failed'); } });
  await network.refresh();
  assert.equal(states.at(-1).state, 'error');
  assert.match(states.at(-1).message, /网络/);
  const timeout = rom.createRomLibrary({
    directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state), timeoutMs: 5,
    fetch: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })),
  });
  await timeout.refresh();
  assert.match(states.at(-1).message, /超时/);

  const pending = timeout.refresh();
  const beforeCancel = states.length;
  timeout.cancel();
  await pending;
  assert.equal(states.length, beforeCancel);
});
test('library uses the same-directory static catalog when listing is forbidden or missing', async () => {
  for (const status of [403, 404]) {
    const requests = [], states = [];
    let cancelled = false;
    const denied = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status });
    const library = rom.createRomLibrary({
      directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
      async fetch(url, options) {
        requests.push({ url, options });
        return requests.length === 1 ? denied : listing([entry('超级 马里奥 #1%.nes')]);
      },
    });
    await library.refresh();
    assert(cancelled, 'Expected the directory error body to be cancelled before requesting the catalog');
    assert.deepEqual(requests.map(request => request.url), [
      'https://example.com/blog/roms/', 'https://example.com/blog/roms/index.json',
    ]);
    assert.equal(requests[0].options, requests[1].options);
    assert.deepEqual({ ...requests[1].options, signal: undefined }, {
      signal: undefined, mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    assert.equal(states.at(-1).state, 'ready');
    assert.equal(states.at(-1).games[0].url, `https://example.com/blog/roms/${encodeURIComponent('超级 马里奥 #1%.nes')}`);
  }
});

test('library does not request a fallback for successful, malformed, server-error or network responses', async () => {
  for (const scenario of ['success', 'empty', 'malformed', 'server-error', 'network']) {
    const requests = [], states = [];
    const library = rom.createRomLibrary({
      directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
      async fetch(url) {
        requests.push(url);
        if (scenario === 'network') throw new TypeError('Network failed');
        if (scenario === 'server-error') return new Response('unavailable', { status: 503 });
        if (scenario === 'malformed') return new Response('<html>not JSON</html>');
        return listing(scenario === 'empty' ? [] : [entry('one.nes')]);
      },
    });
    await library.refresh();
    assert.equal(requests.length, 1, scenario);
    assert.equal(states.at(-1).state, scenario === 'success' ? 'ready' : scenario === 'empty' ? 'empty' : 'error', scenario);
  }
});

test('static catalog failures remain bounded errors without further fallback requests', async () => {
  for (const scenario of ['missing', 'malformed', 'oversize']) {
    const states = [];
    let requests = 0;
    const library = rom.createRomLibrary({
      directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
      async fetch() {
        if (++requests === 1) return new Response('forbidden', { status: 403 });
        if (scenario === 'missing') return new Response('missing', { status: 404 });
        if (scenario === 'malformed') return new Response('<html>not JSON</html>');
        return new Response('[]', { headers: { 'Content-Length': String(rom.MAX_LIBRARY_BYTES + 1) } });
      },
    });
    await library.refresh();
    assert.equal(requests, 2, scenario);
    assert.equal(states.at(-1).state, 'error', scenario);
    assert.match(states.at(-1).message, scenario === 'oversize' ? /列表过大/ : /暂不可用/);
  }
});

test('stale and cancelled directory errors never start a static catalog request', async () => {
  const requests = [], states = [];
  const library = rom.createRomLibrary({
    directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
    fetch(url, options) { return new Promise(resolve => requests.push({ url, options, resolve })); },
  });
  const old = library.refresh();
  const current = library.refresh();
  requests[0].resolve(new Response('forbidden', { status: 403 }));
  await old;
  assert.equal(requests.length, 2);
  requests[1].resolve(listing([entry('current.nes')]));
  await current;
  assert.equal(states.at(-1).games[0].title, 'current');

  const cancelled = library.refresh();
  const beforeCancel = states.length;
  library.cancel();
  requests[2].resolve(new Response('missing', { status: 404 }));
  await cancelled;
  assert.equal(requests.length, 3);
  assert(requests[2].options.signal.aborted);
  assert.equal(states.length, beforeCancel);
});

test('library rechecks cancellation after releasing a directory error body', async () => {
  let releaseBody, bodyCancellation;
  const cancelling = new Promise(resolve => { bodyCancellation = resolve; });
  const requests = [], states = [];
  const library = rom.createRomLibrary({
    directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
    async fetch(url) {
      requests.push(url);
      return new Response(new ReadableStream({
        cancel() { bodyCancellation(); return new Promise(resolve => { releaseBody = resolve; }); },
      }), { status: 403 });
    },
  });
  const pending = library.refresh();
  await cancelling;
  const beforeCancel = states.length;
  library.cancel();
  releaseBody();
  await pending;
  assert.equal(requests.length, 1);
  assert.equal(states.length, beforeCancel);
});

test('replacing a pending static catalog aborts it and ignores its late result', async () => {
  for (const failure of [false, true]) {
    const requests = [], states = [];
    const library = rom.createRomLibrary({
      directory: libraryDirectory, base: libraryBase, onChange: state => states.push(state),
      fetch(url, options) {
        return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
      },
    });
    const old = library.refresh();
    requests[0].resolve(new Response('forbidden', { status: 403 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests[1].url, 'https://example.com/blog/roms/index.json');
    const current = library.refresh();
    assert(requests[1].options.signal.aborted);
    requests[2].resolve(listing([entry('current.nes')]));
    await current;
    if (failure) requests[1].reject(new TypeError('Old catalog failed'));
    else requests[1].resolve(listing([entry('old.nes')]));
    await old;
    assert.equal(states.at(-1).games[0].title, 'current');
    assert(!states.some(state => state.state === 'error'));
  }
});

test('static catalog shares the refresh timeout and explicit cancellation signal', async () => {
  for (const cancel of [false, true]) {
    const requests = [], states = [];
    let fallbackStarted;
    const started = new Promise(resolve => { fallbackStarted = resolve; });
    const library = rom.createRomLibrary({
      directory: libraryDirectory, base: libraryBase, timeoutMs: cancel ? 1000 : 10,
      onChange: state => states.push(state),
      fetch(url, options) {
        requests.push({ url, options });
        if (requests.length === 1) return Promise.resolve(new Response('missing', { status: 404 }));
        fallbackStarted();
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      },
    });
    const pending = library.refresh();
    await started;
    if (cancel) library.cancel();
    await pending;
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.signal, requests[1].options.signal);
    assert(requests[1].options.signal.aborted);
    if (cancel) assert.deepEqual(states.map(state => state.state), ['loading']);
    else assert.match(states.at(-1).message, /超时/);
  }
});

test('vendored core can execute an original synthetic test ROM', () => {
  const { NES } = require('../static/vendor/jsnes/2.1.0/jsnes.min.js');
  let frames = 0;
  const nes = new NES({ onFrame(buffer) { assert.equal(buffer.length, 256 * 240); frames++; }, emulateSound: false });
  nes.loadROM(fixture());
  for (let frame = 0; frame < 3; frame++) nes.frame();
  assert.equal(frames, 3);
});
test('original pulse program generates finite, non-silent stereo samples', () => {
  const { NES } = require('../static/vendor/jsnes/2.1.0/jsnes.min.js');
  let nonSilent = 0;
  const nes = new NES({ sampleRate: 48000, onAudioSample(left, right) {
    assert(Number.isFinite(left) && Number.isFinite(right));
    if (Math.abs(left) + Math.abs(right) > 0.001) nonSilent++;
  } });
  nes.loadROM(fixture({ tone: true }));
  for (let frame = 0; frame < 10; frame++) nes.frame();
  assert(nonSilent > 100, 'Expected an audible synthetic pulse');
});
test('audio worklet bounds its queue, plays stereo in order and resets to silence', () => {
  let Processor;
  class FakeProcessor { constructor() { this.port = {}; } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/nes-audio-worklet.js'), 'utf8'), {
    AudioWorkletProcessor: FakeProcessor,
    registerProcessor(name, implementation) { assert.equal(name, 'nes-audio-queue'); Processor = implementation; },
  });
  const queue = new Processor();
  for (let block = 0; block < 80; block++) {
    queue.port.onmessage({ data: { left: new Float32Array(256).fill(block), right: new Float32Array(256).fill(-block) } });
  }
  assert.equal(queue.count, queue.capacity);
  const left = new Float32Array(128), right = new Float32Array(128);
  queue.process([], [[left, right]]);
  assert.equal(left[0], 16);
  assert.equal(right[0], -16);
  queue.port.onmessage({ data: { reset: true } });
  queue.process([], [[left, right]]);
  assert(left.every(value => value === 0) && right.every(value => value === 0));
});
