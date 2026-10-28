/**
 * Luật 7 nét treo cổ và công thức tính điểm – dùng chung cho mọi dạng câu hỏi.
 */

/** 7 nét: giá, dây, đầu, thân, tay trái, tay phải, chân. */
export const STROKE_NAMES = ["Giá", "Dây", "Đầu", "Thân", "Tay trái", "Tay phải", "Chân"] as const;
export const MAX_STROKES = STROKE_NAMES.length;

/**
 * - ALIVE: đang chơi
 * - HANGED: đủ 7 nét, thành khán giả (có thể được "Gói cứu trợ của Nhà nước" cứu một lần)
 * - ELIMINATED: đã được cứu mà lại đủ 7 nét – bị loại chung cuộc
 */
export type PlayerStatus = "ALIVE" | "HANGED" | "ELIMINATED";

export interface PlayerState {
  nickname: string;
  score: number;
  strokes: number;
  status: PlayerStatus;
  streak: number;
  /** Đã dùng gói cứu trợ (được cứu hoặc trả lời sai câu cứu trợ). */
  bailoutUsed?: boolean;
  correctCount?: number;
  /** Tổng thời gian trả lời (ms) – dùng để phá hoà. Không trả lời tính bằng cả thời gian giới hạn. */
  totalAnswerMs?: number;
  online?: boolean;
  joinedAt?: number;
}

/** Cộng n nét (tối đa 7). Đủ 7 nét: bị treo, hoặc bị loại nếu đã từng được cứu. */
export function addStrokes(strokes: number, n: number, bailoutUsed = false): { strokes: number; status: PlayerStatus } {
  const next = Math.min(MAX_STROKES, Math.max(0, strokes) + Math.max(0, n));
  if (next < MAX_STROKES) return { strokes: next, status: "ALIVE" };
  return { strokes: next, status: bailoutUsed ? "ELIMINATED" : "HANGED" };
}

/** Hệ số thưởng theo số nét đang có: 0 nét ×1.2, 1–2 nét ×1.1, còn lại ×1. Người đã được cứu luôn ×1. */
export function strokeMultiplier(strokes: number, bailoutUsed = false): number {
  if (bailoutUsed) return 1;
  if (strokes <= 0) return 1.2;
  if (strokes <= 2) return 1.1;
  return 1;
}

/** Điểm cơ bản theo tốc độ: round(1000 * (1 - 0.5 * t / T)), t bị kẹp trong [0, T]. */
export function basePoints(elapsedMs: number, limitMs: number): number {
  if (limitMs <= 0) return 500;
  const t = Math.min(Math.max(elapsedMs, 0), limitMs);
  return Math.round(1000 * (1 - (0.5 * t) / limitMs));
}

/** Thưởng chuỗi: 100 * (số câu đúng liên tiếp - 1). */
export function streakBonus(streak: number): number {
  return 100 * Math.max(0, streak - 1);
}

/** Mỗi chữ đoán sai trong câu đoán chữ trừ 10% điểm tốc độ (không âm). */
export const WRONG_LETTER_PENALTY = 0.1;

export function wrongLetterFactor(wrongLetters: number): number {
  return Math.max(0, 1 - WRONG_LETTER_PENALTY * Math.max(0, wrongLetters));
}

/**
 * Điểm cho một câu trả lời đúng.
 * @param strokes số nét đang có lúc được chấm
 * @param newStreak số câu đúng liên tiếp, đã tính cả câu này
 * @param bailoutUsed người đã được cứu không còn hưởng hệ số nhân
 * @param wrongLetters số chữ đã đoán sai (câu đoán chữ) – trừ 10% điểm tốc độ mỗi chữ, thưởng chuỗi giữ nguyên
 */
export function computePoints(
  elapsedMs: number,
  limitMs: number,
  strokes: number,
  newStreak: number,
  bailoutUsed = false,
  wrongLetters = 0,
): number {
  const speed = basePoints(elapsedMs, limitMs) * strokeMultiplier(strokes, bailoutUsed) * wrongLetterFactor(wrongLetters);
  return Math.round(speed) + streakBonus(newStreak);
}
