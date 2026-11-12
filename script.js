/* =========================================
   REACTION MASTER - SPEED TEST モード ＋ 共通処理（音声・画面切り替え）
   MIND GAME モードは mind.js
   ========================================= */

// ---------- 設定 ----------
const CONFIG = {
  totalTargets: 20,        // クリアに必要なヒット数
  countdownFrom: 3,        // カウントダウン秒数
  missPenaltyMs: 30,       // ランク判定でミス1回ごとに加算するペナルティ(ms)
  goDurationMs: 650,       // GO! の表示〜フェードアウトの長さ（style.css の goFade と合わせる）
  storageKey: "reactionMaster.speedTest.best",
  soundKey: "reactionMaster.sound",
  bgmKey: "reactionMaster.bgm",          // BGM の ON/OFF
  volumeKey: "reactionMaster.volume",    // BGM・効果音それぞれの音量
  defaultBgmVolume: 0.3,   // BGM の初期音量（0〜1・控えめ）
  defaultSfxVolume: 1.0,   // 効果音の初期音量（0〜1・従来と同じ音量）
  bgmFadeOutSec: 1.2,      // 結果画面へ移るときの BGM フェードアウト秒数
  hitVibrateMs: 12,        // Android: タップ成功時の振動の長さ(ms)
};

// ランク表（「ランク判定用スコア」がこの値未満ならそのランク）
// スコア = 平均反応時間 + ミス回数 × ペナルティ
const RANKS = [
  { rank: "S", limit: 380, title: "神速の覇者" },
  { rank: "A", limit: 450, title: "電光石火" },
  { rank: "B", limit: 520, title: "鋭き狩人" },
  { rank: "C", limit: 600, title: "安定の射手" },
  { rank: "D", limit: 700, title: "見習いハンター" },
  { rank: "E", limit: 850, title: "のんびり屋" },
  { rank: "F", limit: Infinity, title: "寝起きモード" },
];

// ---------- 要素の取得 ----------
const $ = (id) => document.getElementById(id);
const screens = {
  title: $("screen-title"),
  game: $("screen-game"),
  result: $("screen-result"),
  mindRules: $("screen-mind-rules"),
  mind: $("screen-mind"),
  mindResult: $("screen-mind-result"),
};
// プレイ中の画面（BGM を流し続ける画面）
const PLAY_SCREENS = ["game", "mind"];

function isPlayScreenActive() {
  return PLAY_SCREENS.some((name) => screens[name].classList.contains("active"));
}
const field = $("field");
const countdownEl = $("countdown");

// ---------- ゲーム状態 ----------
let state = null;

function newState() {
  return {
    playing: false,     // ターゲットをタップできる状態か
    times: [],          // 各ヒットの反応時間(ms)
    misses: 0,
    target: null,       // 現在のターゲット要素
    spawnTime: 0,       // ターゲットが出現した時刻
    timers: [],         // カウントダウン用タイマー
  };
}

// ---------- 画面切り替え ----------
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  // 結果画面はゆっくりフェードアウト、タイトルへはすぐ止める
  if (!PLAY_SCREENS.includes(name)) {
    const toResult = name === "result" || name === "mindResult";
    stopBgm(toResult ? CONFIG.bgmFadeOutSec : 0.3);
  }
}

// ---------- 自己ベスト（ブラウザ保存） ----------
function loadBest() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveBest(record) {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(record));
  } catch (e) {
    // プライベートモードなどで保存できない場合は無視
  }
}

function formatBest(best) {
  if (!best) return "---";
  return `${best.avg} ms (${best.rank})`;
}

function updateTitleBest() {
  $("title-best").textContent = formatBest(loadBest());
}

// ---------- ゲーム開始 ----------
function startGame() {
  if (state) clearTimers();
  state = newState();

  // 画面とHUDを初期化
  field.querySelectorAll(".target, .hit-fx, .hit-ripple, .hit-time, .miss-fx").forEach((el) => el.remove());
  $("hud-count").textContent = `0/${CONFIG.totalTargets}`;
  $("hud-last").textContent = "---";
  $("hud-miss").textContent = "0";
  $("hud-time").textContent = "0.00";
  $("progress-bar").style.width = "0%";
  showScreen("game");

  runCountdown();
}

function runCountdown() {
  let n = CONFIG.countdownFrom;
  const tick = () => {
    countdownEl.classList.remove("pop", "go");
    void countdownEl.offsetWidth; // アニメーションを再スタートさせるため
    if (n > 0) {
      countdownEl.textContent = n;
      countdownEl.classList.add("pop");
      n--;
      state.timers.push(setTimeout(tick, 1000));
    } else {
      // GO! 表示中は playing=false のまま → タップしても判定されない
      countdownEl.textContent = "GO!";
      countdownEl.classList.add("pop", "go");
      state.timers.push(setTimeout(() => {
        countdownEl.classList.remove("pop", "go");
        countdownEl.textContent = "";
        // GO! が消えてから最初のターゲットを出現させ、ここから計測開始
        state.playing = true;
        spawnTarget();
        startHudTimer();
      }, CONFIG.goDurationMs));
    }
  };
  tick();
}

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}

// ---------- HUDタイマー（表示専用・計測処理には関与しない） ----------
function startHudTimer() {
  const owner = state;
  owner.hudStart = performance.now();
  const timeEl = $("hud-time");
  let lastText = "";
  const loop = () => {
    // 別のゲームが始まった or プレイ終了したら停止
    if (state !== owner || !owner.playing) return;
    const text = ((performance.now() - owner.hudStart) / 1000).toFixed(2);
    if (text !== lastText) {
      timeEl.textContent = text;
      lastText = text;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- ターゲット ----------
function spawnTarget() {
  const rect = field.getBoundingClientRect();
  // ターゲットの直径：画面幅の約17%（最小52px、最大90px）
  const size = Math.max(52, Math.min(90, rect.width * 0.17));
  const margin = size / 2 + 6;

  // 前回と近すぎない位置をランダムに選ぶ
  let x, y, tries = 0;
  const prev = state.lastPos;
  do {
    x = margin + Math.random() * (rect.width - margin * 2);
    y = margin + Math.random() * (rect.height - margin * 2);
    tries++;
  } while (prev && Math.hypot(x - prev.x, y - prev.y) < size * 1.5 && tries < 20);
  state.lastPos = { x, y };

  const t = document.createElement("div");
  t.className = "target";
  t.style.width = `${size}px`;
  t.style.height = `${size}px`;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
  field.appendChild(t);

  state.target = t;
  state.targetInfo = { x, y, size };
  state.spawnTime = performance.now();
}

// フィールドをタップしたときの処理（ヒットかミスかを判定）
function onFieldPointerDown(e) {
  if (!state || !state.playing || !state.target) return;
  e.preventDefault();

  const now = performance.now();
  const rect = field.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const { x, y, size } = state.targetInfo;

  // 円の中をタップしたか（少しだけ判定を甘めに）
  const hit = Math.hypot(px - x, py - y) <= size / 2 + 4;

  if (hit) {
    handleHit(now - state.spawnTime, px, py);
  } else {
    handleMiss(px, py);
  }
}

function handleHit(reaction, px, py) {
  const ms = Math.round(reaction);
  state.times.push(ms);

  const { x, y, size } = state.targetInfo;
  // 判定対象から即座に外す（縮小演出中の要素は判定に使われない＝二重判定なし）
  const oldTarget = state.target;
  state.target = null;
  oldTarget.classList.add("hit-out");
  setTimeout(() => oldTarget.remove(), 160);

  // エフェクト・効果音（計測値は確定済みなので反応時間には影響しない）
  playHitSound();
  addFx("hit-ripple", px, py, { width: `${size * 1.6}px`, height: `${size * 1.6}px` }, "", 240);
  addFx("hit-time", x, y - size / 2, {}, `${ms}`, 600);

  // HUD更新
  const count = state.times.length;
  $("hud-count").textContent = `${count}/${CONFIG.totalTargets}`;
  $("hud-last").textContent = `${ms}`;
  $("progress-bar").style.width = `${(count / CONFIG.totalTargets) * 100}%`;

  hitHaptic();

  if (count >= CONFIG.totalTargets) {
    state.playing = false;
    $("hud-time").textContent = ((performance.now() - state.hudStart) / 1000).toFixed(2);
    setTimeout(showResult, 500);
  } else {
    spawnTarget();
  }
}

function handleMiss(px, py) {
  state.misses++;
  const missEl = $("hud-miss");
  missEl.textContent = state.misses;
  missEl.classList.add("bump");
  setTimeout(() => missEl.classList.remove("bump"), 200);

  addFx("miss-fx", px, py, {}, "MISS", 500);
  field.classList.remove("shake");
  void field.offsetWidth;
  field.classList.add("shake");

  vibrate([30, 30, 30]);
}

// ---------- 触覚フィードバック ----------
// "vibrate" : navigator.vibrate() 対応端末（主に Android）
// "none"    : 非対応（iPhone Safari・PC など）
//   ※ iPhone Safari の switch チェックボックスを使う手法は実機で振動しなかったため不採用
const HAPTIC_MODE = detectHapticMode();
const hapticOn = HAPTIC_MODE === "vibrate"; // 対応端末では常にON

function detectHapticMode() {
  try {
    if (typeof navigator.vibrate === "function") return "vibrate";
  } catch (e) {}
  return "none";
}

// 振動（Android など navigator.vibrate 対応ブラウザのみ）
function vibrate(pattern) {
  if (!hapticOn || HAPTIC_MODE !== "vibrate") return;
  try {
    navigator.vibrate(pattern);
  } catch (e) {
    // 非対応・拒否された場合は無視
  }
}

// タップ成功時の触覚（反応時間は確定済みなので計測には影響しない）
function hitHaptic() {
  vibrate(CONFIG.hitVibrateMs);
}



// ---------- 効果音（Web Audio API で生成。音声ファイル不要） ----------
let audioCtx = null;
let soundOn = loadSoundSetting();

function loadSoundSetting() {
  try {
    return localStorage.getItem(CONFIG.soundKey) !== "off";
  } catch (e) {
    return true;
  }
}

function setSound(on) {
  soundOn = on;
  try {
    localStorage.setItem(CONFIG.soundKey, on ? "on" : "off");
  } catch (e) {}
  updateSoundButton();
  if (on) {
    // ONにしたとき確認用に一度鳴らす（resume 完了後）
    const p = unlockAudio();
    if (p && typeof p.then === "function") p.then(playHitSound, () => {});
    else playHitSound();
  }
}

function updateSoundButton() {
  const btn = $("btn-sound");
  btn.setAttribute("aria-pressed", String(soundOn));
  btn.querySelector(".sound-state").textContent = soundOn ? "ON" : "OFF";
  if ($("vol-sfx")) updateVolumeSliderState();
}

// iOS ではユーザー操作の中で AudioContext を作成・再開する必要がある
function unlockAudio() {
  if (!soundOn && !bgmOn) return;
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      // 効果音と BGM は別々の音量ツマミ（GainNode）を通して出力する
      sfxBus = audioCtx.createGain();
      sfxBus.gain.value = volumes.sfx;
      sfxBus.connect(audioCtx.destination);
      bgmBus = audioCtx.createGain();
      bgmBus.gain.value = volumes.bgm;
      bgmBus.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") return audioCtx.resume();
  } catch (e) {
    audioCtx = null;
  }
}

// 短く明るい電子音（約90ms）
function playHitSound(at) {
  if (!soundOn || !audioCtx || audioCtx.state !== "running") return null;
  try {
    const t = typeof at === "number" ? at : audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(2200, t + 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain);
    gain.connect(sfxBus);
    osc.start(t);
    osc.stop(t + 0.1);
    return osc;
  } catch (e) {
    // 音が鳴らなくてもゲームは続行
    return null;
  }
}

// ---------- BGM（Web Audio API でオリジナル曲を生成） ----------
// 8小節のテクノループ（BPM124・Aマイナー：Am → F → C → G）を OfflineAudioContext で
// 一度だけ音声データに書き出し、ゲーム中はそれをループ再生するだけにする。
// → プレイ中に音を組み立てる処理が走らないため、タップ判定・反応時間計測に影響しない。
let sfxBus = null;
let bgmBus = null;
let bgmOn = loadBgmSetting();
let volumes = loadVolumes();
let bgmBufferPromise = null;   // 生成は1回だけ（結果を使い回す）
let bgmPlayer = null;          // 再生中の { source, fade }（同時に1つだけ）
let bgmSession = 0;            // 古い再生要求を無効にするための番号

function loadBgmSetting() {
  try {
    return localStorage.getItem(CONFIG.bgmKey) !== "off";
  } catch (e) {
    return true;
  }
}

function loadVolumes() {
  const v = { bgm: CONFIG.defaultBgmVolume, sfx: CONFIG.defaultSfxVolume };
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.volumeKey) || "{}");
    if (typeof saved.bgm === "number") v.bgm = clamp01(saved.bgm);
    if (typeof saved.sfx === "number") v.sfx = clamp01(saved.sfx);
  } catch (e) {}
  return v;
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function saveVolumes() {
  try {
    localStorage.setItem(CONFIG.volumeKey, JSON.stringify(volumes));
  } catch (e) {}
}

// 音量調整（0〜1）。BGM と効果音は別々に設定・保存できる
function setBgmVolume(v) {
  volumes.bgm = clamp01(v);
  if (bgmBus) bgmBus.gain.setTargetAtTime(volumes.bgm, audioCtx.currentTime, 0.05);
  saveVolumes();
}

function setSfxVolume(v) {
  volumes.sfx = clamp01(v);
  if (sfxBus) sfxBus.gain.setTargetAtTime(volumes.sfx, audioCtx.currentTime, 0.05);
  saveVolumes();
}

// ---- 音量スライダー（タイトル画面） ----
const BGM_BPM = 124;
let previewTimer = null;
let seSyncTimer = null;     // SE 連動のスケジューラ
let seNextBeat = 0;         // 次に SE を鳴らす拍の時刻（AudioContext の時間）
let seScheduled = [];       // 予約済みの SE（試聴終了時に取り消す）

// スライダーを動かしている間だけ BGM を試聴し、離して少し経ったら止める
function previewBgm() {
  if (!bgmOn || isPlayScreenActive()) return;
  if (!bgmPlayer) startBgm(true);
  startSeSync();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    stopSeSync();
    if (!isPlayScreenActive()) stopBgm(0.4);
  }, 1500);
}

// BGM 試聴中は SE を BGM の拍（4分音符）に合わせて鳴らし、音量バランスを確認できるようにする
// ※タイトル画面の試聴中だけ動く。ゲーム中の処理には関与しない
function startSeSync() {
  if (seSyncTimer) return;
  seNextBeat = 0;
  const tick = () => {
    if (isPlayScreenActive()) {
      stopSeSync();
      return;
    }
    const player = bgmPlayer;
    if (player && player.preview && soundOn && audioCtx && audioCtx.state === "running") {
      const beat = 60 / BGM_BPM;
      const now = audioCtx.currentTime;
      // 再生開始時刻を基準に、次の拍の時刻を求める（ループ長は拍の整数倍なのでずれない）
      if (seNextBeat < now) {
        seNextBeat = player.startTime + Math.ceil((now + 0.02 - player.startTime) / beat) * beat;
      }
      // 少し先（0.25秒分）まで予約しておくと、タイマーの揺れがあっても拍からずれない
      while (seNextBeat < now + 0.25) {
        const osc = playHitSound(seNextBeat);
        if (osc) seScheduled.push({ osc, at: seNextBeat });
        seNextBeat += beat;
      }
      seScheduled = seScheduled.filter((s) => s.at > now - 0.2);
    }
    seSyncTimer = setTimeout(tick, 100);
  };
  tick();
}

function stopSeSync() {
  clearTimeout(seSyncTimer);
  seSyncTimer = null;
  if (audioCtx) {
    const now = audioCtx.currentTime;
    // まだ鳴っていない予約分は取り消す
    seScheduled.forEach((s) => {
      if (s.at > now) {
        try { s.osc.stop(); } catch (e) {}
      }
    });
  }
  seScheduled = [];
}

function initVolumeSliders() {
  const sliders = [
    { key: "bgm", setter: setBgmVolume },
    { key: "sfx", setter: setSfxVolume },
  ];
  sliders.forEach(({ key, setter }) => {
    const input = $(`vol-${key}`);
    const label = $(`vol-${key}-val`);
    const render = () => {
      const pct = Math.round(volumes[key] * 100);
      input.value = pct;
      label.textContent = pct;
      input.style.setProperty("--fill", `${pct}%`);
    };
    render();
    // iPhone はユーザー操作の中で音声を有効にする必要がある
    input.addEventListener("pointerdown", unlockAudio);
    input.addEventListener("input", () => {
      unlockAudio();
      setter(input.value / 100);
      render();
      previewBgm(); // BGM ON なら試聴＋SE を拍に合わせて連動
    });
    // BGM OFF のときは、SE は指を離したときに一度鳴らして確認
    input.addEventListener("change", () => {
      if (key !== "sfx" || bgmOn) return;
      const p = unlockAudio();
      if (p && typeof p.then === "function") p.then(playHitSound, () => {});
      else playHitSound();
    });
  });
  updateVolumeSliderState();
}

// ON/OFF が OFF のときはスライダーを薄く表示（操作は可能）
function updateVolumeSliderState() {
  $("vol-bgm").closest(".vol-row").classList.toggle("is-off", !bgmOn);
  $("vol-sfx").closest(".vol-row").classList.toggle("is-off", !soundOn);
}

function setBgm(on) {
  bgmOn = on;
  try {
    localStorage.setItem(CONFIG.bgmKey, on ? "on" : "off");
  } catch (e) {}
  updateBgmButton();
  if (on) {
    unlockAudio();
    if (isPlayScreenActive()) startBgm();
  } else {
    stopBgm(0.3);
  }
}

function updateBgmButton() {
  const btn = $("btn-bgm");
  btn.setAttribute("aria-pressed", String(bgmOn));
  btn.querySelector(".sound-state").textContent = bgmOn ? "ON" : "OFF";
  if ($("vol-bgm")) updateVolumeSliderState();
}

function getBgmBuffer() {
  if (!bgmBufferPromise) {
    bgmBufferPromise = renderBgm().catch(() => {
      bgmBufferPromise = null; // 失敗したら次回また試す（BGMなしでもゲームは動く）
      return null;
    });
  }
  return bgmBufferPromise;
}

function startBgm(preview = false) {
  if (!preview) stopSeSync(); // ゲーム開始時はタイトルでの SE 連動を確実に止める
  if (!bgmOn || !audioCtx || !bgmBus) return;
  stopBgm(0.05); // 二重再生を防ぐ
  const session = ++bgmSession;
  getBgmBuffer().then((buffer) => {
    // 生成待ちの間に停止・再スタート・画面移動があった場合は再生しない
    if (!buffer || session !== bgmSession || !bgmOn) return;
    if (!preview && !isPlayScreenActive()) return;
    try {
      const t = audioCtx.currentTime;
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = true; // 曲の長さ＝ちょうど8小節なので継ぎ目なくループ
      const fade = audioCtx.createGain();
      fade.gain.setValueAtTime(0.0001, t);
      fade.gain.exponentialRampToValueAtTime(1, t + 0.4);
      source.connect(fade);
      fade.connect(bgmBus);
      source.start(t);
      bgmPlayer = { source, fade, startTime: t, preview };
    } catch (e) {}
  });
}

function stopBgm(fadeSec) {
  bgmSession++; // 生成待ちの再生要求も取り消す
  const player = bgmPlayer;
  bgmPlayer = null;
  if (!player || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const g = player.fade.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    g.exponentialRampToValueAtTime(0.0001, t + fadeSec);
    player.source.stop(t + fadeSec + 0.05);
    player.source.onended = () => {
      player.source.disconnect();
      player.fade.disconnect();
    };
  } catch (e) {}
}

// ---- 曲の生成 ----
function renderBgm() {
  const BPM = BGM_BPM;
  const BARS = 8;
  const RATE = 44100;
  const beat = 60 / BPM;
  const step = beat / 4;                 // 16分音符
  const length = Math.round(BARS * 4 * beat * RATE);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return Promise.reject(new Error("no OfflineAudioContext"));
  const ctx = new Offline(1, length, RATE);

  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(ctx.destination);

  // ノイズ（ハイハット・クラップ・ライザー用）
  const noise = ctx.createBuffer(1, RATE, RATE);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const env = (g, t, peak, attack, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };

  const kick = (t) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 0.9, 0.002, 0.26);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.3);
  };

  const noiseHit = (t, type, freq, q, peak, decay) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, 0.001, decay);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.02);
  };

  const bass = (t, freq, dur) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 7;
    f.frequency.setValueAtTime(1300, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    env(g, t, 0.32, 0.004, dur * 0.9);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  };

  const arp = (t, freq, cutoff) => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = cutoff; f.Q.value = 4;
    const g = ctx.createGain();
    env(g, t, 0.05, 0.003, step * 0.85);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + step);
  };

  const pad = (t, freqs, dur) => {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.4);
    g.gain.setValueAtTime(0.02, t + dur - 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + dur - 0.02); // 次のコード・ループ頭に残響を残さない
    f.connect(g); g.connect(out);
    freqs.forEach((fr) => [-6, 6].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = fr;
      o.detune.value = cents;
      o.connect(f);
      o.start(t); o.stop(t + dur);
    }));
  };

  // コード進行（2小節ずつ）：Am → F → C → G
  const chords = [
    { bass: 55.0,  arp: [220.0, 261.63, 329.63, 440.0],  pad: [110.0, 130.81, 164.81] },
    { bass: 43.65, arp: [174.61, 220.0, 261.63, 349.23], pad: [87.31, 110.0, 130.81] },
    { bass: 65.41, arp: [196.0, 261.63, 329.63, 392.0],  pad: [130.81, 164.81, 196.0] },
    { bass: 49.0,  arp: [196.0, 246.94, 293.66, 392.0],  pad: [98.0, 123.47, 146.83] },
  ];
  const arpOrder = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2];

  for (let bar = 0; bar < BARS; bar++) {
    const chord = chords[Math.floor(bar / 2)];
    const barT = bar * 4 * beat;
    if (bar % 2 === 0) pad(barT, chord.pad, 8 * beat);
    for (let s = 0; s < 16; s++) {
      const t = barT + s * step;
      const pos = s % 4;
      if (pos === 0) kick(t);                                           // 4つ打ち
      if (pos === 2) noiseHit(t, "highpass", 8000, 0.7, 0.10, 0.06);    // 裏拍のハイハット
      else if (pos !== 0) noiseHit(t, "highpass", 9000, 0.7, 0.03, 0.025);
      if (s === 4 || s === 12) noiseHit(t, "bandpass", 1600, 0.9, 0.18, 0.14); // クラップ
      if (pos !== 0) bass(t, chord.bass * (s % 8 === 7 ? 2 : 1), step * 0.9); // 転がるベース
      // 後半4小節はフィルターを開いて疾走感を上げる
      const cutoff = bar < 4 ? 1500 : 1500 + (bar - 3) * 350;
      arp(t, chord.arp[arpOrder[s]], cutoff);
    }
  }

  // 最終小節の後半：ループ頭へ向けたノイズのライザー
  {
    const t = (BARS - 0.5) * 4 * beat;
    const dur = 2 * beat - 0.01;
    const s = ctx.createBufferSource();
    s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.Q.value = 1.5;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + dur * 0.95);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t); s.stop(t + dur);
  }

  const finish = (buffer) => {
    // 音割れしないよう最大音量を揃える
    const d = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) {
      const k = 0.9 / peak;
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
    return buffer;
  };

  // 古い Safari は Promise を返さず oncomplete で通知する
  return new Promise((resolve, reject) => {
    ctx.oncomplete = (e) => resolve(finish(e.renderedBuffer));
    try {
      const p = ctx.startRendering();
      if (p && typeof p.then === "function") p.catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ページを閉じる・別タブ・ホームに戻ったときは音を一時停止し、戻ったら再開
document.addEventListener("visibilitychange", () => {
  if (!audioCtx) return;
  try {
    if (document.hidden) audioCtx.suspend();
    else if (soundOn || bgmOn) audioCtx.resume();
  } catch (e) {}
});
window.addEventListener("pagehide", () => {
  try {
    if (audioCtx) audioCtx.suspend();
  } catch (e) {}
});

// 一時的なエフェクト要素を追加して、一定時間後に消す
function addFx(className, x, y, style, text, life) {
  const el = document.createElement("div");
  el.className = className;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  Object.assign(el.style, style);
  el.textContent = text;
  field.appendChild(el);
  setTimeout(() => el.remove(), life);
}

// ---------- リザルト ----------
function getRank(score) {
  return RANKS.find((r) => score < r.limit);
}

function showResult() {
  const times = state.times;
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const best = Math.min(...times);
  const totalTaps = times.length + state.misses;
  const accuracy = Math.round((times.length / totalTaps) * 1000) / 10;
  const score = avg + state.misses * CONFIG.missPenaltyMs;
  const r = getRank(score);

  // 自己ベスト判定（ランク判定用スコアが低いほど良い）
  const prevBest = loadBest();
  const isNewRecord = !prevBest || score < prevBest.score;
  if (isNewRecord) {
    saveBest({ score, avg, best, accuracy, misses: state.misses, rank: r.rank, date: Date.now() });
  }

  // 表示
  const rankEl = $("rank");
  rankEl.textContent = r.rank;
  rankEl.classList.toggle("rank-low", ["E", "F"].includes(r.rank));
  rankEl.dataset.rank = r.rank; // ランク別の配色用（見た目のみ）
  rankEl.style.animation = "none";
  void rankEl.offsetWidth;
  rankEl.style.animation = "";

  $("rank-title").textContent = `「${r.title}」`;
  $("new-record").classList.toggle("show", isNewRecord);
  $("res-avg").textContent = `${avg} ms`;
  $("res-best").textContent = `${best} ms`;
  $("res-acc").textContent = `${accuracy}%`;
  $("res-miss").textContent = `${state.misses}`;
  $("res-pb").textContent = formatBest(loadBest());

  state.result = { avg, best, accuracy, misses: state.misses, rank: r.rank, title: r.title };
  // オンラインランキング（ミス0のときだけ登録対象。判定・ランク計算には影響しない）
  if (typeof rankingOnResult === "function") {
    rankingOnResult("speed", { times: times.slice(), misses: state.misses, perfect: state.misses === 0 });
  }
  showScreen("result");
}

// ---------- X（旧Twitter）で共有 ----------
function shareToX() {
  if (!state || !state.result) return;
  const r = state.result;
  const text =
    `⚡REACTION MASTER - SPEED TEST⚡\n` +
    `RANK: ${r.rank}「${r.title}」\n` +
    `平均: ${r.avg}ms / ベスト: ${r.best}ms\n` +
    `命中率: ${r.accuracy}% / ミス: ${r.misses}回\n` +
    `#ReactionMaster`;
  const url = location.href.split("#")[0];
  const shareUrl =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(text) +
    "&url=" + encodeURIComponent(url);
  window.open(shareUrl, "_blank", "noopener");
}

// ---------- イベント登録 ----------
// START / RETRY のタップをきっかけに音声を開始（iPhone Safari の自動再生制限対策）
$("btn-start").addEventListener("click", () => { unlockAudio(); startGame(); startBgm(); });
$("btn-retry").addEventListener("click", () => { unlockAudio(); startGame(); startBgm(); });
$("btn-sound").addEventListener("click", () => setSound(!soundOn));
$("btn-bgm").addEventListener("click", () => setBgm(!bgmOn));
$("btn-share").addEventListener("click", shareToX);
$("btn-home").addEventListener("click", () => {
  updateTitleBest();
  showScreen("title");
});
field.addEventListener("pointerdown", onFieldPointerDown);

// 長押しメニューやダブルタップズームを防ぐ
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault());

// 起動時
updateTitleBest();
updateSoundButton();
updateBgmButton();
initVolumeSliders();
// BGM の音声データを先に作っておく（ユーザー操作不要・再生はしない）
setTimeout(() => { if (bgmOn) getBgmBuffer(); }, 800);
