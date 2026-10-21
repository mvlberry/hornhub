import { MAX_ROM_BYTES, validateRom, romURL, readRomResponse, createRomLibrary } from './nes-rom.mjs';

const root = document.querySelector('[data-nes-player]');
if (root) setupPlayer(root);

function setupPlayer(player) {
  const page = player.closest('.games-page');
  const viewport = player.querySelector('.nes-viewport');
  const canvas = player.querySelector('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const status = page.querySelector('.nes-status');
  const title = player.querySelector('[data-current-game]');
  const overlayTitle = player.querySelector('[data-overlay-title]');
  const overlayHint = player.querySelector('[data-overlay-hint]');
  const fileInput = player.querySelector('[data-rom-file]');
  const control = action => player.querySelector(`[data-action="${action}"]`);
  const libraryElement = page.querySelector('[data-rom-library]');
  const librarySelect = libraryElement.querySelector('[data-library-select]');
  const libraryPlay = libraryElement.querySelector('[data-library-play]');
  const libraryRefresh = libraryElement.querySelector('[data-library-refresh]');
  const libraryStatus = libraryElement.querySelector('[data-library-status]');
  const touchButtons = [...player.querySelectorAll('[data-nes-button]')];
  if (!window.jsnes || !context) {
    status.textContent = '模拟器加载失败，请刷新页面，或使用支持 Canvas 的现代浏览器。';
    status.dataset.error = 'true';
    libraryElement.dataset.state = 'error';
    libraryElement.setAttribute('aria-busy', 'false');
    libraryStatus.textContent = '模拟器未就绪，请刷新页面后重试。';
    libraryRefresh.disabled = true;
    return;
  }
  const { NES, Controller } = window.jsnes;
  const frame = context.createImageData(256, 240);
  const pixels = new Uint32Array(frame.data.buffer);
  const buttonMap = { ArrowUp: 'UP', KeyW: 'UP', ArrowDown: 'DOWN', KeyS: 'DOWN', ArrowLeft: 'LEFT', KeyA: 'LEFT', ArrowRight: 'RIGHT', KeyD: 'RIGHT', KeyX: 'A', KeyZ: 'B', Enter: 'START', ShiftLeft: 'SELECT', ShiftRight: 'SELECT' };
  const held = new Map();
  let nes = null;
  let romData = null;
  let gameName = '';
  let running = false;
  let loading = false;
  let animation = 0;
  let previousTime = 0;
  let elapsed = 0;
  let loadSequence = 0;
  let request = null;
  let muted = true;
  let soundBusy = false;
  let audioContext = null;
  let audioNode = null;
  let audioPromise = null;
  const sampleLeft = new Float32Array(256);
  const sampleRight = new Float32Array(256);
  let sampleCount = 0;

  function announce(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }
  function controls() {
    control('pause').disabled = !nes || loading;
    control('pause').textContent = nes && !running ? '继续' : '暂停';
    control('restart').disabled = !nes || loading;
    control('sound').disabled = !nes || soundBusy;
    control('sound').textContent = muted ? '开启声音' : '关闭声音';
    control('sound').setAttribute('aria-pressed', String(!muted));
    touchButtons.forEach(button => { button.disabled = !running; });
  }
  function overlay(state, heading, hint) {
    player.dataset.state = state;
    overlayTitle.textContent = heading;
    overlayHint.textContent = hint;
  }
  function press(name, source) {
    if (!running) return;
    const sources = held.get(name) || new Set();
    if (!sources.size) nes.buttonDown(1, Controller[`BUTTON_${name}`]);
    sources.add(source);
    held.set(name, sources);
    touchButtons.filter(button => button.dataset.nesButton === name).forEach(button => button.classList.add('is-held'));
  }
  function release(name, source) {
    const sources = held.get(name);
    if (!sources) return;
    sources.delete(source);
    if (!sources.size) {
      nes?.buttonUp(1, Controller[`BUTTON_${name}`]);
      held.delete(name);
      touchButtons.filter(button => button.dataset.nesButton === name).forEach(button => button.classList.remove('is-held'));
    }
  }
  function releaseAll() {
    for (const name of held.keys()) nes?.buttonUp(1, Controller[`BUTTON_${name}`]);
    held.clear();
    touchButtons.forEach(button => button.classList.remove('is-held'));
  }
  function clearAudio() {
    sampleCount = 0;
    audioNode?.port.postMessage({ reset: true });
  }
  function pause(report = true) {
    running = false;
    cancelAnimationFrame(animation);
    animation = 0;
    releaseAll();
    clearAudio();
    audioContext?.suspend().catch(() => {});
    if (nes && !loading) {
      overlay('paused', '游戏已暂停', '点击「继续」或在画面内按空格，回到游戏。');
      if (report) announce(`${gameName} · 已暂停`);
    }
    controls();
  }
  function flushSamples() {
    if (!audioNode || !sampleCount) return;
    audioNode.port.postMessage({ left: sampleLeft.slice(0, sampleCount), right: sampleRight.slice(0, sampleCount) });
    sampleCount = 0;
  }
  function writeSample(left, right) {
    if (muted || !running || !audioNode) return;
    sampleLeft[sampleCount] = left;
    sampleRight[sampleCount++] = right;
    if (sampleCount === sampleLeft.length) flushSamples();
  }
  async function ensureAudio() {
    if (!audioPromise) {
      audioPromise = (async () => {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('Audio unavailable');
        audioContext = new Audio({ sampleRate: 48000, latencyHint: 'interactive' });
        if (!audioContext.audioWorklet) throw new Error('AudioWorklet unavailable');
        await audioContext.audioWorklet.addModule(player.dataset.audioWorklet);
        audioNode = new AudioWorkletNode(audioContext, 'nes-audio-queue', { outputChannelCount: [2] });
        audioNode.connect(audioContext.destination);
      })().catch(error => {
        audioContext?.close().catch(() => {});
        audioContext = audioNode = audioPromise = null;
        throw error;
      });
    }
    await audioPromise;
    if (running && !muted) await audioContext.resume();
  }
  function tick(time) {
    if (!running) return;
    if (!previousTime) previousTime = time - 1000 / 60;
    elapsed += Math.min(time - previousTime, 50);
    previousTime = time;
    try {
      while (elapsed >= 1000 / 60) { nes.frame(); elapsed -= 1000 / 60; }
      flushSamples();
    } catch {
      pause(false);
      overlay('error', '这盘卡带暂时无法运行', '可尝试重新开始，或选择其他 iNES 格式 ROM。');
      announce('ROM 运行异常，可能使用了暂不支持的映射器或指令。', true);
      return;
    }
    animation = requestAnimationFrame(tick);
  }
  function start() {
    if (!nes || loading || running) return;
    if (document.hidden || !document.hasFocus()) { pause(); return; }
    running = true;
    previousTime = elapsed = 0;
    overlay('running', '', '');
    announce(`${gameName} · 正在运行${muted ? '（静音）' : ''}`);
    controls();
    viewport.focus({ preventScroll: true });
    if (!muted) ensureAudio().catch(() => {
      muted = true;
      controls();
      announce('声音暂不可用，游戏仍可静音运行。', true);
    });
    animation = requestAnimationFrame(tick);
  }
  function install(bytes, name) {
    validateRom(bytes);
    const candidate = new NES({
      sampleRate: 48000,
      onFrame(buffer) {
        for (let i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | buffer[i];
        context.putImageData(frame, 0, 0);
      },
      onAudioSample: writeSample,
    });
    try { candidate.loadROM(bytes); } catch { throw new Error('这份 ROM 暂不兼容，请尝试其他 iNES 格式 ROM。'); }
    nes = candidate;
    romData = bytes;
    gameName = name;
    title.textContent = name;
  }
  async function load(read, name) {
    const sequence = ++loadSequence;
    request?.abort();
    request = new AbortController();
    const controller = request;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    pause(false);
    loading = true;
    overlay('loading', '正在读取卡带', '稍等片刻，八位世界就要开始了。');
    announce('正在加载 ROM…');
    controls();
    try {
      const bytes = await read(controller.signal);
      if (sequence !== loadSequence) return;
      if (controller.signal.aborted) throw new DOMException('ROM reading aborted', 'AbortError');
      install(bytes, name);
      loading = false;
      start();
    } catch (error) {
      if (sequence !== loadSequence) return;
      controller.abort();
      loading = false;
      overlay('error', '卡带没有读出来', nes ? '上一盘游戏还在，可以点击「继续」，或换一份 ROM。' : '请检查文件格式，或换一份 ROM 再试。');
      const message = timedOut ? '加载超时，请检查网络后重试。' : error.name === 'TypeError' ? '无法读取 ROM，请检查路径和网络后重试。' : error.message;
      announce(message, true);
    } finally {
      clearTimeout(timeout);
      if (sequence === loadSequence) { loading = false; controls(); }
    }
  }
  let selectedGameURL = '';
  let libraryGames = new Map();
  const library = createRomLibrary({
    directory: libraryElement.dataset.directory,
    base: document.baseURI,
    onChange({ state, games, message }) {
      libraryElement.dataset.state = state;
      libraryElement.setAttribute('aria-busy', String(state === 'loading'));
      libraryRefresh.disabled = state === 'loading';
      librarySelect.disabled = state !== 'ready';
      libraryPlay.disabled = state !== 'ready';
      if (state === 'ready') {
        libraryGames = new Map(games.map(game => [game.url, game]));
        const options = games.map(game => {
          const option = document.createElement('option');
          option.value = game.url;
          option.textContent = game.title;
          return option;
        });
        librarySelect.replaceChildren(...options);
        if (libraryGames.has(selectedGameURL)) librarySelect.value = selectedGameURL;
        selectedGameURL = librarySelect.value;
        libraryStatus.textContent = `共有 ${games.length} 盘卡带。选择后点击「开始游戏」。`;
      } else {
        libraryGames.clear();
        const option = document.createElement('option');
        option.value = '';
        option.textContent = state === 'loading' ? '正在读取游戏列表…' : state === 'empty' ? '暂无可用游戏' : '游戏列表暂不可用';
        librarySelect.replaceChildren(option);
        libraryStatus.textContent = state === 'loading' ? '正在读取服务器游戏列表…' : state === 'empty' ? '卡带架还是空的，稍后刷新看看，也可以打开本地 ROM。' : message;
      }
    },
  });
  libraryRefresh.addEventListener('click', () => library.refresh());
  librarySelect.addEventListener('change', () => {
    selectedGameURL = librarySelect.value;
    libraryPlay.disabled = !libraryGames.has(selectedGameURL);
  });
  libraryPlay.addEventListener('click', () => {
    const game = libraryGames.get(librarySelect.value);
    if (!game) return;
    load(async signal => {
      const url = romURL(game.url, document.baseURI);
      const response = await fetch(url, { signal, mode: 'same-origin', credentials: 'same-origin', redirect: 'error' });
      return readRomResponse(response);
    }, game.title);
  });
  library.refresh();
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    load(async () => {
      if (!/\.nes$/i.test(file.name)) throw new Error('请选择未压缩的 .nes 文件，不支持 ZIP 压缩包。');
      if (file.size > MAX_ROM_BYTES) throw new Error('ROM 不能超过 8 MB。');
      return validateRom(new Uint8Array(await file.arrayBuffer()));
    }, file.name.replace(/\.nes$/i, ''));
  });
  player.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'open': fileInput.click(); break;
      case 'pause': running ? pause() : start(); break;
      case 'restart':
        pause(false);
        try { install(romData, gameName); start(); }
        catch { overlay('error', '这盘卡带暂时无法运行', '请重新选择 ROM。'); announce('重新开始失败，请重新选择 ROM。', true); }
        break;
      case 'sound':
        muted = !muted;
        soundBusy = true;
        controls();
        try {
          if (!muted) await ensureAudio();
          else { clearAudio(); await audioContext?.suspend(); }
          announce(`${gameName} · ${muted ? '声音已关闭' : '声音已开启'}`);
        } catch { muted = true; announce('此浏览器暂无法播放声音，游戏仍可静音运行。', true); }
        finally { soundBusy = false; controls(); }
        break;
      case 'fullscreen':
        try { if (document.fullscreenElement) await document.exitFullscreen(); else await player.requestFullscreen(); }
        catch { announce('当前浏览器不支持全屏，可以继续在页面内游玩。'); }
        break;
    }
  });
  const interactive = target => target.closest('button, input, a, select, textarea');
  player.addEventListener('keydown', event => {
    if (interactive(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.code === 'Space' && nes && !loading) {
      event.preventDefault();
      if (!event.repeat) running ? pause() : start();
    } else if (buttonMap[event.code] && running) {
      event.preventDefault();
      press(buttonMap[event.code], event.code);
    }
  });
  window.addEventListener('keyup', event => {
    if (buttonMap[event.code]) release(buttonMap[event.code], event.code);
  });
  viewport.addEventListener('pointerdown', () => viewport.focus({ preventScroll: true }));
  viewport.addEventListener('blur', releaseAll);
  touchButtons.forEach(button => {
    const name = button.dataset.nesButton;
    button.addEventListener('pointerdown', event => {
      if (!running || event.button > 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      press(name, `pointer-${event.pointerId}`);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => release(name, `pointer-${event.pointerId}`));
    }
    button.addEventListener('keydown', event => {
      if (['Enter', 'Space'].includes(event.code)) { event.preventDefault(); press(name, `touch-key-${event.code}`); }
    });
    button.addEventListener('keyup', event => {
      if (['Enter', 'Space'].includes(event.code)) { event.preventDefault(); release(name, `touch-key-${event.code}`); }
    });
    button.addEventListener('blur', () => { release(name, 'touch-key-Enter'); release(name, 'touch-key-Space'); });
  });
  window.addEventListener('blur', () => { if (running) pause(); else releaseAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) pause(); });
  document.addEventListener('fullscreenchange', () => { control('fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏'; });
  window.addEventListener('pagehide', event => {
    library.cancel();
    ++loadSequence;
    request?.abort();
    loading = false;
    pause(false);
    if (!nes) overlay('empty', '放入一盘卡带', '从卡带架选择一款游戏，或打开自己的 .nes 文件。');
    if (!event.persisted) audioContext?.close().catch(() => {});
  });
  window.addEventListener('pageshow', event => { if (event.persisted) library.refresh(); });
  control('fullscreen').disabled = !player.requestFullscreen;
  controls();
}
