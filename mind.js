/* =========================================
   REACTION MASTER - MIND GAME モード
   緑＝1回タップ / 赤＝待つ / 黄＝2回タップ
   ※ script.js（共通処理・音声）の後に読み込む
   ========================================= */

const MIND = {
  rounds: 30,
  tapLimitMs: 1500,        // 緑・黄：出現からこの時間内に正しい操作
  redWaitMs: 1000,         // 赤：この時間タップせずに待てば成功
  doubleTapGapMs: 500,     // 黄：1回目と2回目の間隔の上限
  nextDelayOkMs: 280,      // 成功後、次のターゲットまでの間
  nextDelayMissMs: 520,    // ミス後、次のターゲットまでの間（演出を見せる）
  maxSameInRow: 2,         // 同じ色が続くのは最大2回まで
  storageKey: "reactionMaster.mindGame.best",
};

const MIND_COLORS = ["green", "red", "yellow"];

// 正解率に応じた称号
const MIND_TITLES = [
  { min: 100, title: "完全なる読心者" },
  { min: 90, title: "冷静沈着" },
  { min: 75, title: "判断の達人" },
  { min: 60, title: "迷える挑戦者" },
  { min: 0, title: "混乱中…" },
];

// タイトル画面の MIND BEST に添えるランク（スコア基準）
// 目安：S＝全問正解かつ速い / A＝全問正解 / B＝1ミス程度 / C＝2〜3ミス
// ※ オンラインランキングの MIND_RANKS（平均反応時間ms基準）とは別物
const MIND_SCORE_RANKS = [
  { rank: "S", min: 6500 },
  { rank: "A", min: 6200 },
  { rank: "B", min: 5700 },
  { rank: "C", min: 5000 },
  { rank: "D", min: 4000 },
  { rank: "E", min: 3000 },
  { rank: "F", min: -Infinity },
];

function mindScoreRank(score) {
  return MIND_SCORE_RANKS.find((r) => score >= r.min).rank;
}

const mindField = $("mind-field");
const mindCountdownEl = $("mind-countdown");

let mind = null;

function newMindState() {
  return {
    running: false,       // カウントダウン〜最終ラウンドまで
    round: 0,             // 現在のラウンド番号（1〜30）
    seq: buildColorSequence(MIND.rounds),
    cur: null,            // 現在のラウンド { color, el, x, y, size, spawnAt, firstTapAt, resolved }
    lastPos: null,
    results: [],          // 各ラウンドの結果（1ラウンド1件だけ）
    times: [],            // 緑・黄の正解操作にかかった時間(ms)。赤は含めない
    rankTimes: [],        // ランキング用の反応時間(ms)：緑＝タップ、黄＝1回目のタップまで。赤は含めない
    correct: 0,
    misses: 0,
    streak: 0,
    maxStreak: 0,
    score: 0,
    timers: [],           // ゲーム全体のタイマー（カウントダウン・次ラウンド）
    roundTimers: [],      // 現在のラウンドの制限時間タイマー
  };
}

// ---------- 色の出現順 ----------
// 各色をほぼ同数ずつ用意し、残り数に応じた重みでランダムに選ぶ。
// 直前に同じ色が maxSameInRow 回続いていたら、その色は選ばない。
// 終盤に1色だけ残って連続が避けられなかった場合は作り直す（ほぼ数回以内で成功）。
function buildColorSequence(total) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const seq = tryColorSequence(total);
    if (maxRun(seq) <= MIND.maxSameInRow) return seq;
  }
  // 念のための保険：色を順番に並べてから、連続しない範囲で入れ替える
  const seq = Array.from({ length: total }, (_, i) => MIND_COLORS[i % MIND_COLORS.length]);
  for (let i = seq.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seq[i], seq[j]] = [seq[j], seq[i]];
    if (maxRun(seq) > MIND.maxSameInRow) [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}

function maxRun(seq) {
  let best = 0, run = 0;
  seq.forEach((c, i) => {
    run = i > 0 && c === seq[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

function tryColorSequence(total) {
  const base = Math.floor(total / MIND_COLORS.length);
  const left = {};
  MIND_COLORS.forEach((c) => { left[c] = base; });
  for (let i = 0; i < total - base * MIND_COLORS.length; i++) {
    left[MIND_COLORS[Math.floor(Math.random() * MIND_COLORS.length)]]++;
  }

  const seq = [];
  for (let i = 0; i < total; i++) {
    const n = MIND.maxSameInRow;
    const recent = seq.slice(-n);
    const banned = recent.length === n && recent.every((c) => c === recent[0]) ? recent[0] : null;
    let pool = MIND_COLORS.filter((c) => left[c] > 0 && c !== banned);
    if (pool.length === 0) pool = MIND_COLORS.filter((c) => left[c] > 0); // 残りが1色だけの場合
    const weight = pool.reduce((sum, c) => sum + left[c], 0);
    let r = Math.random() * weight;
    let pick = pool[pool.length - 1];
    for (const c of pool) {
      r -= left[c];
      if (r < 0) { pick = c; break; }
    }
    left[pick]--;
    seq.push(pick);
  }
  return seq;
}

// ---------- 自己ベスト ----------
function loadMindBest() {
  try {
    const raw = localStorage.getItem(MIND.storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveMindBest(record) {
  try {
    localStorage.setItem(MIND.storageKey, JSON.stringify(record));
  } catch (e) {}
}

function updateTitleMindBest() {
  const best = loadMindBest();
  const ok = best && Number.isFinite(best.score);
  $("title-mind-best").textContent = ok ? `${best.score} (${mindScoreRank(best.score)})` : "---";
}

// ---------- タイマー管理 ----------
function mindLater(fn, ms) {
  const owner = mind;
  const id = setTimeout(() => {
    if (mind === owner) fn(); // 別のゲームに切り替わっていたら何もしない
  }, ms);
  owner.timers.push(id);
  return id;
}

function roundLater(fn, ms) {
  const owner = mind;
  const id = setTimeout(() => {
    if (mind === owner) fn();
  }, ms);
  owner.roundTimers.push(id);
  return id;
}

function clearRoundTimers() {
  if (!mind) return;
  mind.roundTimers.forEach(clearTimeout);
  mind.roundTimers = [];
}

// MIND GAME を完全に止める（モード切り替え・タイトルへ戻るとき）
function stopMind() {
  if (!mind) return;
  mind.running = false;
  mind.timers.forEach(clearTimeout);
  mind.timers = [];
  clearRoundTimers();
  mind.cur = null;
  mind = null;
  mindField.querySelectorAll(".mtarget, .m-ripple, .m-pop, .miss-fx").forEach((el) => el.remove());
  mindCountdownEl.classList.remove("pop", "go");
  mindCountdownEl.textContent = "";
}

// ---------- ゲーム開始 ----------
function startMind() {
  stopMind();
  // SPEED TEST が動いていれば止める（タイマーの重複防止）
  if (typeof state !== "undefined" && state) {
    clearTimers();
    state.playing = false;
    state.target = null;
  }
  mind = newMindState();

  $("mind-score").textContent = "0";
  $("mind-round").textContent = `0/${MIND.rounds}`;
  $("mind-streak").textContent = "0";
  $("mind-miss").textContent = "0";
  $("mind-progress").style.width = "0%";
  showScreen("mind");

  mind.running = true;
  runMindCountdown();
}

function runMindCountdown() {
  let n = CONFIG.countdownFrom;
  const tick = () => {
    mindCountdownEl.classList.remove("pop", "go");
    void mindCountdownEl.offsetWidth;
    if (n > 0) {
      mindCountdownEl.textContent = n;
      mindCountdownEl.classList.add("pop");
      n--;
      mindLater(tick, 1000);
    } else {
      // GO! 表示中はターゲットがない → タップしても判定されない
      mindCountdownEl.textContent = "GO!";
      mindCountdownEl.classList.add("pop", "go");
      mindLater(() => {
        mindCountdownEl.classList.remove("pop", "go");
        mindCountdownEl.textContent = "";
        nextRound(); // GO! が消えてから最初のターゲット
      }, CONFIG.goDurationMs);
    }
  };
  tick();
}

// ---------- ラウンド ----------
function nextRound() {
  if (!mind || !mind.running) return;
  if (mind.round >= MIND.rounds) {
    finishMind();
    return;
  }
  mind.round++;
  $("mind-round").textContent = `${mind.round}/${MIND.rounds}`;

  const color = mind.seq[mind.round - 1];
  const rect = mindField.getBoundingClientRect();
  // サイズ・配置の考え方は SPEED TEST と同じ（画面幅の約17%、前回と近すぎない位置）
  const size = Math.max(52, Math.min(90, rect.width * 0.17));
  const margin = size / 2 + 6;
  let x, y, tries = 0;
  const prev = mind.lastPos;
  do {
    x = margin + Math.random() * (rect.width - margin * 2);
    y = margin + Math.random() * (rect.height - margin * 2);
    tries++;
  } while (prev && Math.hypot(x - prev.x, y - prev.y) < size * 1.5 && tries < 20);
  mind.lastPos = { x, y };

  const el = document.createElement("div");
  el.className = `mtarget mt-look m-${color}`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  mindField.appendChild(el);

  mind.cur = { color, el, x, y, size, spawnAt: performance.now(), firstTapAt: 0, resolved: false };

  // 制限時間（どちらか早い方で、そのラウンドの結果が1回だけ確定する）
  if (color === "red") {
    roundLater(() => resolveRound(true, { reason: "wait" }), MIND.redWaitMs);
  } else {
    roundLater(() => resolveRound(false, { reason: "timeout" }), MIND.tapLimitMs);
  }
}

// プレイエリアのタップ
function onMindPointerDown(e) {
  if (!mind || !mind.running) return;
  e.preventDefault();
  const cur = mind.cur;
  if (!cur || cur.resolved) return; // GO! 表示中・ラウンド間・確定後は無視（二重判定防止）

  const now = performance.now();
  const rect = mindField.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  // 当たり判定は SPEED TEST と同じ（半径＋4px）
  const onTarget = Math.hypot(px - cur.x, py - cur.y) <= cur.size / 2 + 4;
  if (!onTarget) return; // ターゲット以外のタップは記録しない

  const elapsed = now - cur.spawnAt;

  if (cur.color === "red") {
    resolveRound(false, { reason: "touched", px, py });
  } else if (cur.color === "green") {
    if (elapsed <= MIND.tapLimitMs) resolveRound(true, { time: elapsed, px, py });
    else resolveRound(false, { reason: "timeout", px, py });
  } else if (cur.color === "yellow") {
    if (!cur.firstTapAt) {
      if (elapsed > MIND.tapLimitMs) {
        resolveRound(false, { reason: "timeout", px, py });
        return;
      }
      // 1回目：ターゲットは消さずに「あと1回」の状態にする
      cur.firstTapAt = now;
      cur.el.classList.add("armed");
      playHitSound();
      // 0.5秒以内に2回目がなければミス
      roundLater(() => resolveRound(false, { reason: "slow" }), MIND.doubleTapGapMs);
    } else {
      const gap = now - cur.firstTapAt;
      if (gap <= MIND.doubleTapGapMs && elapsed <= MIND.tapLimitMs) {
        // first：出現〜1回目のタップ（ランキング用。判定には使わない）
        resolveRound(true, { time: elapsed, first: cur.firstTapAt - cur.spawnAt, px, py });
      } else {
        resolveRound(false, { reason: "slow", px, py });
      }
    }
  }
}

// ラウンドの結果を確定（1ラウンドにつき必ず1回だけ）
function resolveRound(success, info) {
  const cur = mind && mind.cur;
  if (!cur || cur.resolved) return;
  cur.resolved = true;
  clearRoundTimers();

  const { x, y, size, el, color } = cur;
  const record = { round: mind.round, color, success, reason: info.reason || null, time: null, points: 0 };

  if (success) {
    mind.correct++;
    mind.streak++;
    mind.maxStreak = Math.max(mind.maxStreak, mind.streak);
    // 得点：基本100 ＋ 速さボーナス（緑・黄のみ・最大100）＋ 連続正解ボーナス（最大90）
    let points = 100;
    if (color !== "red") {
      const ms = Math.round(info.time);
      record.time = ms;
      mind.times.push(ms); // 赤の待機成功は平均時間に含めない
      // ランキング用：黄は1回目のタップまで（2回目までの間隔を含めない）
      const rankMs = Math.round(color === "yellow" ? info.first : info.time);
      record.rankTime = rankMs;
      mind.rankTimes.push(rankMs);
      points += Math.round(Math.max(0, MIND.tapLimitMs - ms) / 15);
    }
    points += Math.min(mind.streak - 1, 9) * 10;
    record.points = points;
    mind.score += points;

    // 演出
    if (color === "red") {
      el.classList.add("out-safe");
      mindFx("m-pop", x, y - size / 2, { "--tc": "#FF4D6A" }, `SAFE <small>+${points}</small>`, 600);
    } else {
      el.classList.add("out-ok");
      const tc = color === "yellow" ? "#FFD84D" : "";
      mindFx("m-ripple", info.px, info.py, { width: `${size * 1.6}px`, height: `${size * 1.6}px`, "--tc": tc }, "", 240);
      mindFx("m-pop", x, y - size / 2, { "--tc": tc }, `${record.time}<small>ms +${points}</small>`, 600);
      playHitSound();
      hitHaptic();
    }
  } else {
    mind.misses++;
    mind.streak = 0;
    el.classList.add("out-miss");
    const label = { touched: "DON'T TOUCH", timeout: "TOO SLOW", slow: "TOO SLOW" }[info.reason] || "MISS";
    mindFx("miss-fx", x, y, {}, label, 500);
    mindField.classList.remove("shake");
    void mindField.offsetWidth;
    mindField.classList.add("shake");
    const missEl = $("mind-miss");
    missEl.classList.add("bump");
    setTimeout(() => missEl.classList.remove("bump"), 200);
    vibrate([30, 30, 30]);
  }

  mind.results.push(record);
  setTimeout(() => el.remove(), 260);

  // HUD
  $("mind-score").textContent = `${mind.score}`;
  $("mind-streak").textContent = `${mind.streak}`;
  $("mind-miss").textContent = `${mind.misses}`;
  $("mind-progress").style.width = `${(mind.results.length / MIND.rounds) * 100}%`;

  mind.cur = null;
  mindLater(nextRound, success ? MIND.nextDelayOkMs : MIND.nextDelayMissMs);
}

function mindFx(className, x, y, style, html, life) {
  const fx = document.createElement("div");
  fx.className = className;
  fx.style.left = `${x}px`;
  fx.style.top = `${y}px`;
  Object.entries(style).forEach(([k, v]) => {
    if (!v) return;
    if (k.startsWith("--")) fx.style.setProperty(k, v);
    else fx.style[k] = v;
  });
  fx.innerHTML = html; // 中身はこのファイル内で作った固定文字列と数値のみ
  mindField.appendChild(fx);
  setTimeout(() => fx.remove(), life);
}

// ---------- 結果 ----------
function finishMind() {
  mind.running = false;
  const total = mind.results.length;
  const accuracy = Math.round((mind.correct / total) * 1000) / 10;
  const avg = mind.times.length
    ? Math.round(mind.times.reduce((a, b) => a + b, 0) / mind.times.length)
    : null;
  const title = MIND_TITLES.find((t) => accuracy >= t.min).title;

  const prevBest = loadMindBest();
  const isNewRecord = !prevBest || mind.score > prevBest.score;
  if (isNewRecord) {
    saveMindBest({
      score: mind.score, correct: mind.correct, misses: mind.misses, accuracy,
      avg, maxStreak: mind.maxStreak, date: Date.now(),
    });
  }

  mind.result = {
    score: mind.score, correct: mind.correct, total, misses: mind.misses,
    accuracy, avg, maxStreak: mind.maxStreak, title,
  };
  // オンラインランキング（全問正解のときだけ登録対象。判定・得点には影響しない）
  if (typeof rankingOnResult === "function") {
    rankingOnResult("mind", {
      times: mind.rankTimes.slice(),
      misses: mind.misses,
      perfect: mind.misses === 0 && mind.correct === MIND.rounds,
    });
  }

  const scoreEl = $("mind-res-score");
  scoreEl.textContent = `${mind.score}`;
  scoreEl.style.animation = "none";
  void scoreEl.offsetWidth;
  scoreEl.style.animation = "";
  $("mind-res-title").textContent = `「${title}」`;
  $("mind-new-record").classList.toggle("show", isNewRecord);
  $("mind-res-correct").textContent = `${mind.correct} / ${total}`;
  $("mind-res-miss").textContent = `MISS ${mind.misses}`;
  $("mind-res-acc").textContent = `${accuracy}%`;
  $("mind-res-avg").textContent = avg === null ? "---" : `${avg} ms`;
  $("mind-res-streak").textContent = `${mind.maxStreak}`;
  $("mind-res-best").textContent = `${loadMindBest().score}`;

  mindLater(() => showScreen("mindResult"), 500);
}

// ---------- X で共有 ----------
function shareMindToX() {
  if (!mind || !mind.result) return;
  const r = mind.result;
  const text =
    `🧠REACTION MASTER - MIND GAME🧠\n` +
    `SCORE: ${r.score}「${r.title}」\n` +
    `正解: ${r.correct}/${r.total}（正解率 ${r.accuracy}%）\n` +
    `平均: ${r.avg === null ? "---" : r.avg + "ms"} / 最大連続: ${r.maxStreak}\n` +
    `#ReactionMaster`;
  const url = location.href.split("#")[0];
  const shareUrl =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(text) +
    "&url=" + encodeURIComponent(url);
  window.open(shareUrl, "_blank", "noopener");
}

// ---------- イベント登録（起動時に1回だけ） ----------
function startMindFromUser() {
  unlockAudio(); // iPhone Safari：タップをきっかけに音声を開始
  startMind();
  startBgm();
}

$("btn-mind").addEventListener("click", () => {
  stopMind();
  showScreen("mindRules");
});
$("btn-mind-back").addEventListener("click", () => showScreen("title"));
$("btn-mind-go").addEventListener("click", startMindFromUser);
$("btn-mind-retry").addEventListener("click", startMindFromUser);
$("btn-mind-share").addEventListener("click", shareMindToX);
$("btn-mind-home").addEventListener("click", () => {
  stopMind();
  updateTitleBest();
  updateTitleMindBest();
  showScreen("title");
});
// SPEED TEST を始めるときは MIND GAME のタイマーを止める
$("btn-start").addEventListener("click", stopMind);
$("btn-home").addEventListener("click", updateTitleMindBest);
mindField.addEventListener("pointerdown", onMindPointerDown);

updateTitleMindBest();
