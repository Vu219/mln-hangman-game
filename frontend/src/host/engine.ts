/**
 * Bộ máy host (host-authoritative): chạy trong trình duyệt của host, thay cho Cloud Functions.
 * Chỉ hostUid của phòng mới ghi được meta, currentQuestion, stats, điểm/nét của người chơi (xem database.rules.json).
 * Mọi hàm nhận `db` làm tham số để dùng chung cho trang host và bài E2E chạy bằng Node.
 */
import {
  get,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
} from "firebase/database";
import {
  AnswerFormatError,
  applyGuess,
  bailoutAsQuestion,
  computeStats,
  gradeSubmission,
  initialWordGuess,
  isBailoutEligible,
  isEligible,
  parseQuestionSet,
  resolveBailout,
  resolveOutcome,
  shouldOfferBailout,
  slotKey,
  toPublicQuestion,
  toRevealData,
  type AnswerRecord,
  type BailoutQuestion,
  type LastResult,
  type PlayerState,
  type Question,
  type QuestionSet,
  type RoundInfo,
  type WordGuessState,
} from "../game";

/** Đếm ngược "Chuẩn bị!" sau khi host bấm câu tiếp, trước khi được chọn đáp án. */
export const PREROLL_MS = 5000;

export type RoomStatus = "LOBBY" | "QUESTION" | "REVEAL" | "ROUND_INTRO" | "BAILOUT" | "FINISHED";
export type PublicRoundInfo = Omit<RoundInfo, "bailoutQuestions">;

export interface HostMeta {
  hostUid: string;
  status: RoomStatus;
  currentIndex: number;
  round: number;
  /** Khoá lượt hỏi hiện tại ("5" hoặc "bailout-2"); rules dùng để kiểm tra bài nộp đúng lượt. */
  slot?: string | null;
  /** Server timestamp lúc hiện câu; questionStartedAt = shownAt + PREROLL_MS, deadline = questionStartedAt + thời gian. */
  shownAt?: number | null;
  questionStartedAt?: number | null;
  deadline?: number | null;
  createdAt: number;
  totalQuestions: number;
  title: string;
  roundInfo?: PublicRoundInfo | null;
  bailoutRound?: number | null;
  revealedAt?: number;
  finishedAt?: number;
}

/** Dữ liệu chỉ host đọc/ghi được: roomSecrets/{pin}. */
export interface HostSecrets {
  hostUid: string;
  createdAt: number;
  questions: Question[];
  rounds: RoundInfo[];
  bailoutChosen?: Record<string, BailoutQuestion>;
}

/** Bài nộp của người chơi: rooms/{pin}/submissions/{slot}/{uid}. */
export interface Submission {
  payload?: unknown;
  at?: number;
  /** Câu đoán chữ: chữ cái -> server timestamp lúc đoán. */
  guesses?: Record<string, number>;
  graded?: boolean;
}

export class HostError extends Error {}

const roomPath = (pin: string, path = "") => `rooms/${pin}${path ? `/${path}` : ""}`;
const secretPath = (pin: string, path = "") => `roomSecrets/${pin}${path ? `/${path}` : ""}`;

export async function isAdmin(db: Database, uid: string): Promise<boolean> {
  try {
    return (await get(ref(db, `admins/${uid}`))).val() === true;
  } catch {
    return false;
  }
}

function roundInfoFor(rounds: RoundInfo[], round: number): PublicRoundInfo {
  const found = rounds.find((r) => r.round === round);
  if (!found) return { round, title: `Vòng ${round}` };
  return {
    round: found.round,
    title: found.title,
    ...(found.subtitle ? { subtitle: found.subtitle } : {}),
    ...(found.theme ? { theme: found.theme } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tạo phòng
// ---------------------------------------------------------------------------

/** Validate bộ câu (lỗi tiếng Việt), sinh PIN không trùng bằng transaction, lưu bộ câu đầy đủ vào roomSecrets. */
export async function createRoom(db: Database, hostUid: string, input: unknown): Promise<{ pin: string; title: string; total: number }> {
  const parsed = parseQuestionSet(input);
  if (!parsed.ok) throw new HostError(`Bộ câu hỏi không hợp lệ:\n- ${parsed.errors.join("\n- ")}`);
  const qs: QuestionSet = parsed.data;
  if (!(await isAdmin(db, hostUid))) {
    throw new HostError(`Tài khoản này chưa có quyền host. Nhờ quản trị viên thêm node /admins/${hostUid}: true trong Firebase Console.`);
  }
  const now = Date.now();
  const meta: HostMeta = {
    hostUid,
    status: "LOBBY",
    currentIndex: -1,
    round: 0,
    createdAt: now,
    totalQuestions: qs.questions.length,
    title: qs.title ?? "Giá Treo Cổ Của Tư Bản",
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    // Transaction: chỉ ghi khi PIN chưa có phòng nào dùng.
    const tx = await runTransaction(ref(db, roomPath(pin, "meta")), (current) => (current === null ? meta : undefined), {
      applyLocally: false,
    });
    if (!tx.committed) continue;
    await set(ref(db, secretPath(pin)), { hostUid, createdAt: now, questions: qs.questions, rounds: qs.rounds });
    return { pin, title: meta.title, total: qs.questions.length };
  }
  throw new HostError("Không sinh được mã PIN, vui lòng thử lại.");
}

export async function loadSecrets(db: Database, pin: string): Promise<HostSecrets> {
  const snap = await get(ref(db, secretPath(pin)));
  if (!snap.exists()) throw new HostError("Không tìm thấy bộ câu hỏi của phòng.");
  const s = snap.val() as HostSecrets;
  return { ...s, rounds: s.rounds ?? [] };
}

// ---------------------------------------------------------------------------
// Chuyển trạng thái
// ---------------------------------------------------------------------------

/** Chuyển meta nguyên tử (chống bấm 2 lần). `compute` trả meta mới hoặc chuỗi lỗi. */
async function transitionMeta(db: Database, pin: string, compute: (m: HostMeta) => HostMeta | string): Promise<HostMeta> {
  let failure: string | null = null;
  const tx = await runTransaction(
    ref(db, roomPath(pin, "meta")),
    (current: HostMeta | null) => {
      if (current === null) return current;
      const next = compute(current);
      if (typeof next === "string") {
        failure = next;
        return undefined;
      }
      failure = null;
      return next;
    },
    { applyLocally: false },
  );
  if (!tx.committed || failure) throw new HostError(failure ?? "Không thể cập nhật trạng thái phòng, hãy thử lại.");
  const meta = tx.snapshot.val() as HostMeta | null;
  if (!meta) throw new HostError(`Không tìm thấy phòng ${pin}.`);
  return meta;
}

function roundIntroMeta(m: HostMeta, s: HostSecrets, index: number): HostMeta {
  const q = s.questions[index];
  return {
    ...m,
    status: "ROUND_INTRO",
    currentIndex: index,
    round: q.round,
    roundInfo: roundInfoFor(s.rounds, q.round),
    bailoutRound: null,
    slot: null,
    shownAt: null,
    questionStartedAt: null,
    deadline: null,
  };
}

function questionMeta(m: HostMeta, s: HostSecrets, index: number): HostMeta {
  const q = s.questions[index];
  return {
    ...m,
    status: "QUESTION",
    currentIndex: index,
    round: q.round,
    roundInfo: roundInfoFor(s.rounds, q.round),
    bailoutRound: null,
    slot: String(index),
    shownAt: null,
    questionStartedAt: null,
    deadline: null,
  };
}

function bailoutMeta(m: HostMeta, round: number): HostMeta {
  return { ...m, status: "BAILOUT", bailoutRound: round, slot: `bailout-${round}`, shownAt: null, questionStartedAt: null, deadline: null };
}

async function loadPlayers(db: Database, pin: string): Promise<Record<string, PlayerState>> {
  return ((await get(ref(db, roomPath(pin, "players")))).val() as Record<string, PlayerState> | null) ?? {};
}

/** Câu hỏi (đã có đáp án) của lượt hiện tại – câu thường hoặc câu cứu trợ đã chọn. */
export function questionForSlot(s: HostSecrets, meta: HostMeta): Question | null {
  if (meta.bailoutRound) {
    const bq = s.bailoutChosen?.[String(meta.bailoutRound)];
    return bq ? bailoutAsQuestion(bq, meta.bailoutRound) : null;
  }
  return s.questions[meta.currentIndex] ?? null;
}

/**
 * Ghi câu hỏi công khai + thống kê, rồi đặt mốc thời gian theo đồng hồ server:
 * shownAt = server timestamp, questionStartedAt = shownAt + 5 giây đếm ngược.
 * An toàn khi gọi lại (host tải lại trang giữa chừng).
 */
export async function ensureQuestionPublished(db: Database, pin: string, s: HostSecrets, meta: HostMeta): Promise<void> {
  if ((meta.status !== "QUESTION" && meta.status !== "BAILOUT") || meta.questionStartedAt) return;
  const q = questionForSlot(s, meta);
  if (!q) throw new HostError("Không tìm thấy câu hỏi của lượt hiện tại.");
  const slot = slotKey(meta);
  const current = (await get(ref(db, roomPath(pin, "currentQuestion/slot")))).val();
  if (current !== slot) {
    const players = await loadPlayers(db, pin);
    const pub = { ...toPublicQuestion(q, meta.currentIndex, s.questions.length), slot };
    if (meta.bailoutRound) {
      const eligibleUids = Object.fromEntries(
        Object.entries(players)
          .filter(([, p]) => isBailoutEligible(p))
          .map(([uid]) => [uid, true]),
      );
      await update(ref(db, roomPath(pin)), {
        currentQuestion: { ...pub, bailoutRound: meta.bailoutRound },
        [`stats/${slot}`]: { eligible: Object.keys(eligibleUids).length, answered: 0, rescued: 0, eligibleUids },
      });
    } else {
      const eligible = Object.values(players).filter(isEligible).length;
      await update(ref(db, roomPath(pin)), { currentQuestion: pub, [`stats/${slot}`]: { eligible, answered: 0 } });
    }
  }
  await set(ref(db, roomPath(pin, "meta/shownAt")), serverTimestamp());
  const shownAt = (await get(ref(db, roomPath(pin, "meta/shownAt")))).val() as number;
  const startsAt = shownAt + PREROLL_MS;
  await update(ref(db, roomPath(pin, "meta")), { questionStartedAt: startsAt, deadline: startsAt + q.timeLimitSec * 1000 });
}

export async function startGame(db: Database, pin: string, s: HostSecrets): Promise<HostMeta> {
  const meta = await transitionMeta(db, pin, (m) => (m.status !== "LOBBY" ? "Trò chơi đã bắt đầu rồi." : roundIntroMeta(m, s, 0)));
  await remove(ref(db, roomPath(pin, "currentQuestion")));
  return meta;
}

export async function nextQuestion(db: Database, pin: string, s: HostSecrets): Promise<HostMeta> {
  const total = s.questions.length;
  const players = Object.values(await loadPlayers(db, pin));
  let chosen: { round: number; q: BailoutQuestion } | null = null;

  const meta = await transitionMeta(db, pin, (m) => {
    switch (m.status) {
      case "LOBBY":
        return roundIntroMeta(m, s, 0);
      case "ROUND_INTRO":
        return questionMeta(m, s, m.currentIndex);
      case "REVEAL": {
        const next = m.currentIndex + 1;
        if (next >= total) return { ...m, status: "FINISHED", bailoutRound: null, slot: null, finishedAt: Date.now() };
        // Vừa xong gói cứu trợ → sang vòng mới.
        if (m.bailoutRound) return roundIntroMeta(m, s, next);
        const round = s.questions[m.currentIndex].round;
        if (s.questions[next].round === round) return questionMeta(m, s, next);
        // Hết vòng (không phải vòng cuối vì vẫn còn câu tiếp theo).
        const pool = s.rounds.find((r) => r.round === round)?.bailoutQuestions ?? [];
        if (shouldOfferBailout(players, pool.length > 0, false)) {
          chosen ??= { round, q: pool[Math.floor(Math.random() * pool.length)] };
          return bailoutMeta(m, round);
        }
        return roundIntroMeta(m, s, next);
      }
      case "QUESTION":
      case "BAILOUT":
        return "Hãy hiện đáp án trước khi sang câu tiếp theo.";
      case "FINISHED":
        return "Trò chơi đã kết thúc.";
    }
  });

  if (meta.status === "BAILOUT" && chosen) {
    const c = chosen as { round: number; q: BailoutQuestion };
    await set(ref(db, secretPath(pin, `bailoutChosen/${c.round}`)), c.q);
    s.bailoutChosen = { ...(s.bailoutChosen ?? {}), [String(c.round)]: c.q };
  }
  if (meta.status === "QUESTION" || meta.status === "BAILOUT") await ensureQuestionPublished(db, pin, s, meta);
  else if (meta.status === "ROUND_INTRO") await remove(ref(db, roomPath(pin, "currentQuestion")));
  return meta;
}

export async function endGame(db: Database, pin: string): Promise<HostMeta> {
  return transitionMeta(db, pin, (m) =>
    m.status === "FINISHED" ? "Trò chơi đã kết thúc rồi." : { ...m, status: "FINISHED", finishedAt: Date.now() },
  );
}

/** Dọn phòng: xoá rooms/{pin} và roomSecrets/{pin} (thay cho hàm dọn dẹp định kỳ). */
export async function deleteRoom(db: Database, pin: string): Promise<void> {
  await remove(ref(db, secretPath(pin)));
  await remove(ref(db, roomPath(pin)));
}

// ---------------------------------------------------------------------------
// Chấm bài
// ---------------------------------------------------------------------------

/** Dựng lại bảng đoán chữ từ các chữ đã gửi (theo thời gian server, rồi theo chữ cái) – luôn cho cùng kết quả. */
export function replayWordGuess(index: number, word: string, guesses: Record<string, number> = {}): { state: WordGuessState; lastAt: number | null } {
  let state = initialWordGuess(index, word);
  let lastAt: number | null = null;
  const ordered = Object.entries(guesses).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  for (const [letter, at] of ordered) {
    const r = applyGuess(state, word, letter);
    if (r.outcome === "CLOSED") break;
    if (r.outcome === "REPEAT") continue;
    state = r.state;
    lastAt = at;
  }
  return { state, lastAt };
}

/**
 * Chấm mọi bài nộp chưa chấm của lượt hiện tại (idempotent: bài đã có bản ghi trong roomSecrets/answers thì bỏ qua).
 * Câu đoán chữ: cập nhật bảng riêng của từng người; giải xong / hết lượt sai thì chốt kết quả.
 * Gói cứu trợ: áp dụng kết quả ngay để màn hình host đếm realtime "x/y đã được cứu".
 */
export async function gradeSlot(
  db: Database,
  pin: string,
  s: HostSecrets,
  meta: HostMeta,
  submissions?: Record<string, Submission> | null,
): Promise<void> {
  const q = questionForSlot(s, meta);
  if (!q || meta.questionStartedAt == null) return;
  const slot = slotKey(meta);
  const limitMs = q.timeLimitSec * 1000;
  const startedAt = meta.questionStartedAt;
  const [subsSnap, answersSnap, players] = await Promise.all([
    submissions === undefined ? get(ref(db, roomPath(pin, `submissions/${slot}`))) : Promise.resolve(null),
    get(ref(db, secretPath(pin, `answers/${slot}`))),
    loadPlayers(db, pin),
  ]);
  const subs = (submissions ?? (subsSnap?.val() as Record<string, Submission> | null)) ?? {};
  const answers = (answersSnap.val() as Record<string, AnswerRecord> | null) ?? {};
  const updates: Record<string, unknown> = {};
  const elapsed = (at: number | null | undefined) => Math.min(Math.max(0, (at ?? startedAt + limitMs) - startedAt), limitMs);

  for (const [uid, sub] of Object.entries(subs)) {
    const player = players[uid];
    if (!player) continue;
    if (answers[uid]) {
      if (!sub.graded) updates[`rooms/${pin}/submissions/${slot}/${uid}/graded`] = true;
      continue;
    }
    if (meta.bailoutRound ? !isBailoutEligible(player) : !isEligible(player)) continue;

    let record: AnswerRecord | null = null;
    if (q.type === "WORD_GUESS") {
      const { state, lastAt } = replayWordGuess(meta.currentIndex, q.word, sub.guesses);
      updates[`rooms/${pin}/private/${uid}/wordGuess`] = state;
      if (state.solved || state.failed) {
        record = {
          kind: state.solved ? "WORD_SOLVED" : "WORD_FAILED",
          correct: state.solved,
          penalty: state.solved ? 0 : 1,
          elapsedMs: elapsed(lastAt),
          wrongLetters: state.wrong.length,
          at: lastAt ?? Date.now(),
        };
      }
    } else if (sub.at != null) {
      let grade;
      try {
        grade = gradeSubmission(q, sub.payload);
      } catch (e) {
        // Bài nộp sai định dạng (client bị sửa) – tính như trả lời sai.
        if (!(e instanceof AnswerFormatError)) throw e;
        grade = { correct: false, penalty: 1 };
      }
      record = {
        kind: "SUBMIT",
        correct: grade.correct,
        penalty: grade.penalty,
        elapsedMs: elapsed(sub.at),
        at: sub.at,
        ...("choice" in grade && grade.choice !== undefined ? { choice: grade.choice } : {}),
      };
    }
    if (!record) continue;

    answers[uid] = record;
    updates[`roomSecrets/${pin}/answers/${slot}/${uid}`] = record;
    updates[`rooms/${pin}/submissions/${slot}/${uid}/graded`] = true;
    if (meta.bailoutRound) {
      const outcome = resolveBailout(slot, player, record);
      Object.assign(updates, playerUpdates(pin, uid, outcome.player));
      updates[`rooms/${pin}/private/${uid}/lastResult`] = outcome.result;
      players[uid] = outcome.player;
    }
  }

  const done = Object.values(answers).filter((r) => r.kind !== "NO_ANSWER").length;
  updates[`rooms/${pin}/stats/${slot}/answered`] = done;
  if (meta.bailoutRound) {
    const statsNow = ((await get(ref(db, roomPath(pin, `stats/${slot}/eligibleUids`)))).val() ?? {}) as Record<string, boolean>;
    updates[`rooms/${pin}/stats/${slot}/rescued`] = Object.keys(statsNow).filter((uid) => players[uid]?.status === "ALIVE").length;
  }
  await update(ref(db), updates);
}

function playerUpdates(pin: string, uid: string, p: PlayerState): Record<string, unknown> {
  const base = `rooms/${pin}/players/${uid}`;
  return {
    [`${base}/score`]: p.score,
    [`${base}/strokes`]: p.strokes,
    [`${base}/status`]: p.status,
    [`${base}/streak`]: p.streak,
    [`${base}/bailoutUsed`]: p.bailoutUsed ?? false,
    [`${base}/correctCount`]: p.correctCount ?? 0,
    [`${base}/totalAnswerMs`]: p.totalAnswerMs ?? 0,
  };
}

/**
 * Lắng nghe bài nộp của lượt đang mở và chấm ngay (tuần tự, gộp các thay đổi dồn dập).
 * Trả về hàm huỷ. Dùng lại được sau khi host tải lại trang: chỉ chấm bài chưa có kết quả.
 */
export function startGrader(db: Database, pin: string, s: HostSecrets, meta: HostMeta, onError?: (e: unknown) => void): () => void {
  const slot = slotKey(meta);
  let latest: Record<string, Submission> | null = null;
  let running = false;
  let dirty = false;
  let stopped = false;
  const run = async () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        if (!stopped) await gradeSlot(db, pin, s, meta, latest);
      } while (dirty && !stopped);
    } catch (e) {
      onError?.(e);
    } finally {
      running = false;
    }
  };
  const unsub = onValue(ref(db, roomPath(pin, `submissions/${slot}`)), (snap) => {
    latest = (snap.val() as Record<string, Submission> | null) ?? {};
    void run();
  });
  return () => {
    stopped = true;
    unsub();
  };
}

// ---------------------------------------------------------------------------
// Hiện đáp án
// ---------------------------------------------------------------------------

export async function revealAnswer(db: Database, pin: string, s: HostSecrets): Promise<HostMeta> {
  const before = (await get(ref(db, roomPath(pin, "meta")))).val() as HostMeta;
  const meta = await transitionMeta(db, pin, (m) =>
    m.status !== "QUESTION" && m.status !== "BAILOUT" ? "Hiện không có câu hỏi nào đang chạy." : { ...m, status: "REVEAL", revealedAt: Date.now() },
  );
  // Rules không còn nhận bài nộp mới (status đã là REVEAL): chấm nốt những bài chưa chấm.
  await gradeSlot(db, pin, s, before);
  if (meta.bailoutRound) await revealBailout(db, pin, s, meta);
  else await revealQuestion(db, pin, s, meta);
  return meta;
}

async function revealQuestion(db: Database, pin: string, s: HostSecrets, meta: HostMeta) {
  const index = meta.currentIndex;
  const slot = slotKey(meta);
  const q = s.questions[index];
  const limitMs = q.timeLimitSec * 1000;
  const [players, answersSnap] = await Promise.all([loadPlayers(db, pin), get(ref(db, secretPath(pin, `answers/${slot}`)))]);
  const answers = (answersSnap.val() as Record<string, AnswerRecord> | null) ?? {};
  const now = Date.now();
  const updates: Record<string, unknown> = {};
  const records: AnswerRecord[] = [];
  const results: LastResult[] = [];
  const after: PlayerState[] = [];

  for (const [uid, player] of Object.entries(players)) {
    let record: AnswerRecord | null = answers[uid] ?? null;
    const joinedLate = (player.joinedAt ?? 0) > (meta.questionStartedAt ?? 0);
    if (!record && isEligible(player) && !joinedLate) {
      record = { kind: "NO_ANSWER", correct: false, penalty: 1, at: now };
      updates[`roomSecrets/${pin}/answers/${slot}/${uid}`] = record;
    }
    const outcome = resolveOutcome(slot, player, record, limitMs);
    after.push(outcome.player);
    if (record) {
      records.push(record);
      results.push(outcome.result);
      Object.assign(updates, playerUpdates(pin, uid, outcome.player));
    }
    updates[`rooms/${pin}/private/${uid}/lastResult`] = outcome.result;
  }

  updates[`rooms/${pin}/stats/${slot}`] = computeStats(q, records, after, results);
  updates[`rooms/${pin}/currentQuestion/reveal`] = toRevealData(q);
  await update(ref(db), updates);
}

/** Ai đủ điều kiện cứu trợ mà không nộp: coi như đã dùng cứu trợ (vẫn bị treo). Người còn sống không bị cộng nét. */
async function revealBailout(db: Database, pin: string, s: HostSecrets, meta: HostMeta) {
  const slot = slotKey(meta);
  const q = questionForSlot(s, meta) as Question;
  const [players, answersSnap, statsSnap] = await Promise.all([
    loadPlayers(db, pin),
    get(ref(db, secretPath(pin, `answers/${slot}`))),
    get(ref(db, roomPath(pin, `stats/${slot}`))),
  ]);
  const answers = (answersSnap.val() as Record<string, AnswerRecord> | null) ?? {};
  const eligibleMap = ((statsSnap.val() ?? {}) as { eligibleUids?: Record<string, boolean> }).eligibleUids ?? {};
  const eligibleUids = Object.keys(eligibleMap);
  const now = Date.now();
  const updates: Record<string, unknown> = {};

  for (const uid of eligibleUids) {
    const player = players[uid];
    if (!player || answers[uid]) continue;
    const record: AnswerRecord = { kind: "NO_ANSWER", correct: false, penalty: 0, at: now };
    answers[uid] = record;
    updates[`roomSecrets/${pin}/answers/${slot}/${uid}`] = record;
    const outcome = resolveBailout(slot, player, record);
    players[uid] = outcome.player;
    Object.assign(updates, playerUpdates(pin, uid, outcome.player));
    updates[`rooms/${pin}/private/${uid}/lastResult`] = outcome.result;
  }

  const records = eligibleUids.map((uid) => answers[uid]).filter((r): r is AnswerRecord => !!r);
  updates[`rooms/${pin}/stats/${slot}`] = {
    ...computeStats(q, records, Object.values(players), []),
    rescued: eligibleUids.filter((uid) => players[uid]?.status === "ALIVE").length,
    eligibleUids: eligibleMap,
  };
  updates[`rooms/${pin}/currentQuestion/reveal`] = toRevealData(q);
  await update(ref(db), updates);
}
