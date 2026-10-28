import { addStrokes, computePoints, MAX_STROKES, type PlayerState } from "./rules";
import type { Question } from "./schema";

/**
 * Bản ghi bài nộp (roomSecrets/{pin}/answers/{slot}/{uid}).
 * - SUBMIT: nộp bài các dạng thường
 * - WORD_SOLVED / WORD_FAILED: kết quả câu đoán chữ (WORD_FAILED = hết lượt đoán sai, +1 nét khi hiện đáp án)
 * - NO_ANSWER: hết giờ mà không trả lời (được ghi khi host hiện đáp án)
 */
export interface AnswerRecord {
  kind: "SUBMIT" | "WORD_SOLVED" | "WORD_FAILED" | "NO_ANSWER";
  correct: boolean;
  penalty: number;
  elapsedMs?: number;
  choice?: number;
  /** Câu đoán chữ: số chữ đã đoán sai (mỗi chữ trừ 10% điểm tốc độ). */
  wrongLetters?: number;
  at: number;
}

/**
 * Khoá của một lượt hỏi: chỉ số câu ("5") hoặc câu cứu trợ cuối vòng ("bailout-2").
 * Dùng cho stats/{slot}, answers/{slot} và để client ghép đúng câu hỏi với kết quả.
 */
export function slotKey(meta: { currentIndex: number; bailoutRound?: number | null }): string {
  return meta.bailoutRound ? `bailout-${meta.bailoutRound}` : String(meta.currentIndex);
}

/** Kết quả lượt vừa chơi, ghi vào rooms/{pin}/private/{uid}/lastResult. */
export interface LastResult {
  slot: string;
  bailout: boolean;
  /** Người này có được tham gia lượt này không. */
  participated: boolean;
  answered: boolean;
  correct: boolean;
  points: number;
  strokesAdded: number;
  /** Được gói cứu trợ cứu sống. */
  rescued: boolean;
  hangedNow: boolean;
  eliminatedNow: boolean;
  streak: number;
  /** Câu đoán chữ: số chữ đã đoán sai. */
  wrongLetters: number;
}

/** Câu hỏi thường: chỉ người còn sống được trả lời. */
export function isEligible(player: Pick<PlayerState, "status">): boolean {
  return player.status === "ALIVE";
}

/** Gói cứu trợ: chỉ người đang bị treo và chưa từng dùng cứu trợ. */
export function isBailoutEligible(player: Pick<PlayerState, "status" | "bailoutUsed">): boolean {
  return player.status === "HANGED" && !player.bailoutUsed;
}

/**
 * Có mở "Gói cứu trợ của Nhà nước" khi kết thúc một vòng không:
 * không áp dụng sau vòng cuối, vòng phải có câu cứu trợ và phải có người đủ điều kiện.
 */
export function shouldOfferBailout(
  players: Pick<PlayerState, "status" | "bailoutUsed">[],
  hasBailoutQuestions: boolean,
  isFinalRound: boolean,
): boolean {
  return !isFinalRound && hasBailoutQuestions && players.some(isBailoutEligible);
}

function emptyResult(slot: string, bailout: boolean, player: PlayerState, record: AnswerRecord | null): LastResult {
  return {
    slot,
    bailout,
    participated: record !== null,
    answered: record !== null && record.kind !== "NO_ANSWER",
    correct: record?.correct ?? false,
    points: 0,
    strokesAdded: 0,
    rescued: false,
    hangedNow: false,
    eliminatedNow: false,
    streak: player.streak ?? 0,
    wrongLetters: record?.wrongLetters ?? 0,
  };
}

/**
 * Tính trạng thái mới của một người khi host hiện đáp án câu hỏi thường.
 * @param record bài nộp (hoặc NO_ANSWER), null nếu người này không tham gia câu
 * @param limitMs thời gian giới hạn của câu
 */
export function resolveOutcome(
  slot: string,
  player: PlayerState,
  record: AnswerRecord | null,
  limitMs: number,
): { player: PlayerState; result: LastResult } {
  const result = emptyResult(slot, false, player, record);
  if (!record) return { player, result };

  const bailoutUsed = player.bailoutUsed ?? false;
  const totalAnswerMs = (player.totalAnswerMs ?? 0) + Math.min(record.elapsedMs ?? limitMs, limitMs);

  if (record.correct) {
    const streak = (player.streak ?? 0) + 1;
    const points = computePoints(record.elapsedMs ?? limitMs, limitMs, player.strokes, streak, bailoutUsed, record.wrongLetters ?? 0);
    result.points = points;
    result.streak = streak;
    return {
      player: {
        ...player,
        score: (player.score ?? 0) + points,
        streak,
        correctCount: (player.correctCount ?? 0) + 1,
        totalAnswerMs,
      },
      result,
    };
  }

  // Mỗi câu tối đa +1 nét (kể cả đoán chữ: hết lượt sai hoặc hết giờ mà chưa giải được).
  const next = addStrokes(player.strokes, record.penalty, bailoutUsed);
  const status = player.status === "ALIVE" ? next.status : player.status;
  const fellNow = status !== "ALIVE" && player.status === "ALIVE";
  result.strokesAdded = next.strokes - player.strokes;
  result.hangedNow = fellNow && status === "HANGED";
  result.eliminatedNow = fellNow && status === "ELIMINATED";
  result.streak = 0;
  return { player: { ...player, strokes: next.strokes, status, streak: 0, totalAnswerMs }, result };
}

/**
 * Kết quả câu cứu trợ (chỉ áp dụng cho người HANGED chưa dùng cứu trợ).
 * Đúng: về 6 nét, sống lại, không cộng điểm, mất chuỗi. Sai / hết giờ: vẫn bị treo.
 * Trong cả hai trường hợp gói cứu trợ đã được dùng.
 */
export function resolveBailout(
  slot: string,
  player: PlayerState,
  record: AnswerRecord | null,
): { player: PlayerState; result: LastResult } {
  const result = emptyResult(slot, true, player, record);
  if (!record || !isBailoutEligible(player)) return { player, result: { ...result, participated: false } };

  if (record.correct) {
    const strokes = MAX_STROKES - 1;
    result.rescued = true;
    result.strokesAdded = strokes - player.strokes;
    result.streak = 0;
    return { player: { ...player, strokes, status: "ALIVE", bailoutUsed: true, streak: 0 }, result };
  }
  return { player: { ...player, bailoutUsed: true }, result };
}

/** Thống kê cho màn hình host sau mỗi câu. */
export interface QuestionStats {
  eligible: number;
  answered: number;
  correct: number;
  wrong: number;
  noAnswer: number;
  /** Số người chọn từng đáp án: MC 4 ô, TF [Đúng, Sai]. */
  counts?: number[];
  alive: number;
  hanged: number;
  eliminated: number;
  newlyHanged: number;
  newlyEliminated: number;
  /** Chỉ có ở lượt cứu trợ: số người được cứu. */
  rescued?: number;
}

export function computeStats(
  q: Pick<Question, "type"> & { options?: string[] },
  records: AnswerRecord[],
  playersAfter: PlayerState[],
  results: LastResult[],
): QuestionStats {
  const stats: QuestionStats = {
    eligible: records.length,
    answered: records.filter((r) => r.kind !== "NO_ANSWER").length,
    correct: records.filter((r) => r.correct).length,
    wrong: records.filter((r) => !r.correct && r.kind !== "NO_ANSWER").length,
    noAnswer: records.filter((r) => r.kind === "NO_ANSWER").length,
    alive: playersAfter.filter((p) => p.status === "ALIVE").length,
    hanged: playersAfter.filter((p) => p.status === "HANGED").length,
    eliminated: playersAfter.filter((p) => p.status === "ELIMINATED").length,
    newlyHanged: results.filter((r) => r.hangedNow).length,
    newlyEliminated: results.filter((r) => r.eliminatedNow).length,
  };
  if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") {
    const counts = new Array(q.type === "MULTIPLE_CHOICE" ? (q.options?.length ?? 4) : 2).fill(0);
    for (const r of records) if (typeof r.choice === "number" && r.choice < counts.length) counts[r.choice]++;
    stats.counts = counts;
  }
  return stats;
}

/**
 * Xếp hạng (phá hoà theo thứ tự): điểm cao hơn → ít nét hơn → chưa dùng cứu trợ → tổng thời gian trả lời ít hơn → tên.
 */
export function rankPlayers<
  T extends Pick<PlayerState, "score" | "strokes" | "nickname" | "bailoutUsed" | "totalAnswerMs">,
>(players: T[]): T[] {
  return [...players].sort(
    (a, b) =>
      b.score - a.score ||
      a.strokes - b.strokes ||
      Number(a.bailoutUsed ?? false) - Number(b.bailoutUsed ?? false) ||
      (a.totalAnswerMs ?? 0) - (b.totalAnswerMs ?? 0) ||
      a.nickname.localeCompare(b.nickname, "vi"),
  );
}
