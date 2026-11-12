/* =========================================
   REACTION MASTER - オンラインランキング
   ・ミス0（MIND GAME は30問全問正解）のプレイだけ登録
   ・平均反応時間が短い順（モード別）
   ・プレイヤーごとの自己ベストをサーバーと端末の両方に保存
   ※ script.js / mind.js の後に読み込む。ゲームの判定・得点には一切関与しない
   ========================================= */

const RANKING = {
  // ▼ Supabase の設定（README の「オンラインランキングの準備」を参照）
  //   空のままでもゲームは動き、ランキング記録は端末内の自己ベストだけになる
  supabaseUrl: "https://khddquqnktyohsuyislu.supabase.co",
  supabaseAnonKey: "sb_publishable_fsDRuV3HfZ5SjOYVzVHX_w_7tTET88F", // publishable キー（公開して問題ない鍵）
  limit: 50,             // ランキングに表示する人数
  timeoutMs: 8000,
  playerKey: "reactionMaster.ranking.player",
  bestKeyPrefix: "reactionMaster.ranking.best.",
};

// MIND GAME の評価ランク（暫定値。実際のプレイデータを見て調整する）
// 色を見て判断する分、SPEED TEST より基準を緩くしている
const MIND_RANKS = [
  { rank: "S", limit: 450 },
  { rank: "A", limit: 520 },
  { rank: "B", limit: 600 },
  { rank: "C", limit: 700 },
  { rank: "D", limit: 800 },
  { rank: "E", limit: 950 },
  { rank: "F", limit: Infinity },
];

// モードごとの登録条件（サーバー側の検証と同じ値）
const RANKING_MODES = {
  speed: {
    label: "SPEED TEST",
    count: 20,              // 平均に使う回数
    minMs: 100,
    maxMs: 10000,
    ranks: RANKS,           // SPEED TEST のランク表（ミス0なので 平均 = ランク判定用スコア）
    rule: "ミス0のプレイのみ登録 · 20回の平均反応時間が短い順",
  },
  mind: {
    label: "MIND GAME",
    count: 20,              // 緑10回 ＋ 黄10回（赤は含めない）
    minMs: 100,
    maxMs: 1500,
    ranks: MIND_RANKS,
    rule: "全30問正解のみ登録 · 緑と黄(1回目のタップ)の平均反応時間順 · 赤は対象外",
  },
};

const rk = {
  mode: "speed",          // ランキング画面で表示中のモード
  from: "title",          // ランキング画面を閉じたときに戻る画面
  tokens: { speed: 0, mind: 0 }, // 送信の世代（古い応答で表示を上書きしない）
  listToken: 0,
  last: { speed: null, mind: null }, // 直近のプレイ { eligible, avg, grade }
  dialogFor: null,        // 名前登録後に送信するモード
};

screens.ranking = $("screen-ranking");

// ---------- 計算 ----------
function rkAvg(times) {
  const sum = times.reduce((a, b) => a + b, 0);
  return Math.round((sum / times.length) * 10) / 10; // 小数第1位まで
}

function rkGrade(mode, avg) {
  return RANKING_MODES[mode].ranks.find((r) => avg < r.limit).rank;
}

function rkFormat(avg) {
  return avg == null ? "---" : `${Number(avg).toFixed(1)} ms`;
}

function rkValidTimes(mode, times) {
  const m = RANKING_MODES[mode];
  return Array.isArray(times) && times.length === m.count &&
    times.every((t) => Number.isInteger(t) && t >= m.minMs && t <= m.maxMs);
}

// ---------- 端末への保存 ----------
function rkUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function rkLoad(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function rkSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* 保存できない環境でもゲームは続ける */ }
}

// プレイヤー（端末ごとのランダムID＋名前）。IDは画面に出さず、送信時の本人確認にだけ使う
let rkPlayer = rkLoad(RANKING.playerKey);
if (!rkPlayer || typeof rkPlayer.id !== "string") {
  rkPlayer = { id: rkUuid(), name: "" };
  rkSave(RANKING.playerKey, rkPlayer);
}

function rkLoadBest(mode) {
  return rkLoad(RANKING.bestKeyPrefix + mode);
}

// 登録条件を満たしたプレイを端末の自己ベストに反映。更新したら true
function rkSaveBest(mode, avg, times) {
  const prev = rkLoadBest(mode);
  if (prev && prev.avg <= avg) return false;
  rkSave(RANKING.bestKeyPrefix + mode, { avg, times, date: Date.now(), synced: false });
  return true;
}

function rkMarkSynced(mode, avg) {
  const best = rkLoadBest(mode);
  if (best && best.avg === avg) {
    best.synced = true;
    rkSave(RANKING.bestKeyPrefix + mode, best);
  }
}

// 名前：前後の空白・制御文字を除き、12文字まで
function rkCleanName(name) {
  const s = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, 12).join("");
}

// ---------- サーバー通信（Supabase の RPC） ----------
function rkConfigured() {
  return Boolean(RANKING.supabaseUrl && RANKING.supabaseAnonKey);
}

async function rkRpc(fn, body) {
  const key = RANKING.supabaseAnonKey;
  const headers = { "Content-Type": "application/json", apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // 旧形式（JWT）の anon キー
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RANKING.timeoutMs);
  try {
    const res = await fetch(`${RANKING.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 端末の自己ベスト（1回ごとの時間）を送信。平均・順位はサーバー側で計算し直す
async function rkSubmitBest(mode) {
  const best = rkLoadBest(mode);
  if (!best || !rkValidTimes(mode, best.times)) return null;
  const res = await rkRpc("submit_score", {
    p_mode: mode,
    p_player: rkPlayer.id,
    p_name: rkPlayer.name,
    p_times: best.times,
  });
  rkMarkSynced(mode, best.avg);
  return res;
}

// ---------- 結果画面のランキング欄 ----------
function rkSetBar(mode, state, line1, line2, action) {
  const bar = $(`rk-bar-${mode}`);
  bar.dataset.state = state;
  bar.querySelector(".rk-line1").textContent = line1;
  bar.querySelector(".rk-line2").textContent = line2;
  const btn = bar.querySelector(".rk-action");
  btn.textContent = action || "RANKING";
  btn.disabled = state === "busy";
}

// script.js / mind.js の結果処理から呼ばれる
function rankingOnResult(mode, { times, misses, perfect }) {
  rk.tokens[mode]++;
  const eligible = perfect && misses === 0 && rkValidTimes(mode, times);
  if (!eligible) {
    rk.last[mode] = { eligible: false };
    const reason = misses > 0
      ? `ミス${misses}回のため対象外 · ${mode === "mind" ? "全問正解" : "ミス0"}で登録できます`
      : "計測値が範囲外のため対象外です";
    rkSetBar(mode, "off", "ONLINE RANKING", reason, "RANKING");
    return;
  }

  const avg = rkAvg(times);
  const grade = rkGrade(mode, avg);
  const isNew = rkSaveBest(mode, avg, times);
  rk.last[mode] = { eligible: true, avg, grade, isNew };
  const head = `${rkFormat(avg)} · RANK ${grade}`;

  if (!rkConfigured()) {
    rkSetBar(mode, "local", head, isNew ? "自己ベスト更新！（端末に保存）" : "端末に保存（オンライン未設定）", "RANKING");
  } else if (!rkPlayer.name) {
    rkSetBar(mode, "need-name", head, "名前を登録して参加", "登録");
  } else {
    rkSendFromResult(mode);
  }
}

async function rkSendFromResult(mode) {
  const token = ++rk.tokens[mode];
  const last = rk.last[mode];
  const head = `${rkFormat(last.avg)} · RANK ${last.grade}`;
  rkSetBar(mode, "busy", head, "ランキングに送信中…", "送信中");
  try {
    const res = await rkSubmitBest(mode);
    if (token !== rk.tokens[mode]) return;
    const pos = `${res.position}位 / ${res.total}人`;
    const msg = res.improved || last.isNew
      ? `自己ベスト更新！ ${pos}`
      : `ベスト ${rkFormat(res.best)} · ${pos}`;
    rkSetBar(mode, "done", head, msg, "RANKING");
  } catch (e) {
    if (token !== rk.tokens[mode]) return;
    rkSetBar(mode, "error", head, "送信できませんでした（自己ベストは端末に保存済み）", "再送");
  }
}

function rkOnBarAction(mode) {
  const state = $(`rk-bar-${mode}`).dataset.state;
  if (state === "need-name") {
    rkOpenDialog(mode);
  } else if (state === "error") {
    rkSendFromResult(mode);
  } else {
    rkOpenRanking(mode, mode === "speed" ? "result" : "mindResult");
  }
}

// ---------- ランキング画面 ----------
function rkOpenRanking(mode, from) {
  rk.from = from;
  showScreen("ranking");
  rkShowMode(mode);
}

function rkShowMode(mode) {
  rk.mode = mode;
  document.querySelectorAll(".rk-tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
  });
  $("rk-rule").textContent = RANKING_MODES[mode].rule;
  rkRenderMe(mode, null);
  rkLoadList(mode);
}

// 自分の欄：サーバーの順位があればそれを、なければ端末の自己ベストを表示
function rkRenderMe(mode, meRow) {
  $("rk-name-text").textContent = rkPlayer.name || "名前未登録";
  $("rk-name").classList.toggle("unset", !rkPlayer.name);
  const local = rkLoadBest(mode);
  const avg = meRow ? Number(meRow.avg_ms) : local ? local.avg : null;
  $("rk-me-avg").textContent = rkFormat(avg);
  $("rk-me-rank").textContent = avg == null ? "-" : rkGrade(mode, avg);
  let pos = "記録なし";
  if (meRow) pos = `${meRow.pos}位 / ${meRow.total}人`;
  else if (local) pos = rkConfigured() ? (rkPlayer.name ? "未登録" : "名前を登録すると参加") : "端末に保存";
  $("rk-me-pos").textContent = pos;
}

function rkMessage(text) {
  const el = $("rk-message");
  el.hidden = !text;
  el.textContent = text || "";
}

async function rkLoadList(mode) {
  const token = ++rk.listToken;
  const list = $("rk-list");
  list.replaceChildren();
  $("rk-count").textContent = RANKING_MODES[mode].label;

  if (!rkConfigured()) {
    rkMessage("オンラインランキングは準備中です。\n自己ベストはこの端末に保存されています。");
    return;
  }
  rkMessage("読み込み中…");
  try {
    // 未送信の自己ベストがあれば先に送る
    const local = rkLoadBest(mode);
    if (local && !local.synced && rkPlayer.name) {
      try { await rkSubmitBest(mode); } catch (e) { /* 一覧の表示は続ける */ }
    }
    const rows = await rkRpc("get_ranking", { p_mode: mode, p_player: rkPlayer.id, p_limit: RANKING.limit });
    if (token !== rk.listToken) return;
    rkRenderList(mode, Array.isArray(rows) ? rows : []);
  } catch (e) {
    if (token !== rk.listToken) return;
    rkMessage("ランキングを読み込めませんでした。\n通信環境を確認してください。");
  }
}

function rkRenderList(mode, rows) {
  const list = $("rk-list");
  const meRow = rows.find((r) => r.is_me) || null;
  rkRenderMe(mode, meRow);
  if (rows.length) $("rk-count").textContent = `${rows[0].total} PLAYERS`;
  if (!rows.length) {
    rkMessage("まだ登録がありません。\n最初のランカーになろう！");
    return;
  }
  rkMessage("");
  let prevPos = 0;
  rows.forEach((r) => {
    if (r.pos > prevPos + 1) {
      const gap = document.createElement("li");
      gap.className = "rk-gap";
      gap.textContent = "…";
      list.appendChild(gap);
    }
    prevPos = r.pos;
    const avg = Number(r.avg_ms);
    const li = document.createElement("li");
    li.className = "rk-row" + (r.is_me ? " me" : "") + (r.pos <= 3 ? ` top top-${r.pos}` : "");
    const pos = document.createElement("span");
    pos.className = "rk-pos";
    pos.textContent = r.pos;
    const name = document.createElement("span");
    name.className = "rk-row-name";
    name.textContent = r.name; // 名前は必ず textContent で表示（HTMLとして解釈しない）
    const grade = document.createElement("span");
    grade.className = "rk-grade";
    grade.textContent = rkGrade(mode, avg);
    const time = document.createElement("span");
    time.className = "rk-time";
    time.textContent = rkFormat(avg);
    li.append(pos, name, grade, time);
    list.appendChild(li);
  });
  const me = list.querySelector(".me");
  if (me) me.scrollIntoView({ block: "nearest" });
}

// ---------- 名前の登録・変更 ----------
function rkOpenDialog(forMode) {
  rk.dialogFor = forMode || null;
  const input = $("rk-name-input");
  input.value = rkPlayer.name;
  $("rk-dialog-note").textContent = "ランキングに表示されます（12文字まで）";
  $("rk-dialog").hidden = false;
  input.focus();
}

function rkCloseDialog() {
  $("rk-dialog").hidden = true;
  $("rk-name-input").blur();
  rk.dialogFor = null;
}

async function rkSubmitName(e) {
  e.preventDefault();
  const name = rkCleanName($("rk-name-input").value);
  if (!name) {
    $("rk-dialog-note").textContent = "名前を入力してください";
    return;
  }
  const forMode = rk.dialogFor;
  const changed = name !== rkPlayer.name;
  rkPlayer.name = name;
  rkSave(RANKING.playerKey, rkPlayer);
  rkCloseDialog();

  if (forMode && rk.last[forMode] && rk.last[forMode].eligible) {
    rkSendFromResult(forMode); // 結果画面から登録した場合はそのまま送信
  }
  if (screens.ranking.classList.contains("active")) {
    rkRenderMe(rk.mode, null);
    if (changed && rkConfigured()) {
      try { await rkRpc("rename_player", { p_player: rkPlayer.id, p_name: name }); } catch (err) { /* 次回送信時に反映 */ }
    }
    rkLoadList(rk.mode);
  }
}

// ---------- イベント登録（起動時に1回だけ） ----------
$("btn-ranking").addEventListener("click", () => rkOpenRanking(rk.mode, "title"));
document.querySelectorAll(".rk-action").forEach((btn) => {
  btn.addEventListener("click", () => rkOnBarAction(btn.dataset.mode));
});
document.querySelectorAll(".rk-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.mode !== rk.mode) rkShowMode(tab.dataset.mode);
  });
});
$("rk-name").addEventListener("click", () => rkOpenDialog(null));
$("btn-rk-back").addEventListener("click", () => {
  rk.listToken++;
  if (rk.from === "title") {
    updateTitleBest();
    updateTitleMindBest();
  }
  showScreen(rk.from);
});
$("rk-form").addEventListener("submit", rkSubmitName);
$("rk-cancel").addEventListener("click", rkCloseDialog);
$("rk-dialog").addEventListener("pointerdown", (e) => {
  if (e.target === $("rk-dialog")) rkCloseDialog(); // 枠の外をタップで閉じる
});
