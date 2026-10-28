import { baseLetter } from "./text";

/** Che từ: chữ cái -> "_", ký tự khác (khoảng trắng, gạch nối…) giữ nguyên. */
export function maskWord(word: string): string[] {
  return [...word.toUpperCase()].map((ch) => (baseLetter(ch) ? "_" : ch));
}

/** Trạng thái bảng đoán chữ riêng của một người (lưu ở rooms/{pin}/private/{uid}/wordGuess). */
export interface WordGuessState {
  index: number;
  board: string[];
  guessed: string[];
  wrong: string[];
  solved: boolean;
  failed: boolean;
}

export function initialWordGuess(index: number, word: string): WordGuessState {
  return { index, board: maskWord(word), guessed: [], wrong: [], solved: false, failed: false };
}

export type GuessOutcome = "HIT" | "MISS" | "REPEAT" | "CLOSED";

/**
 * Số lượt đoán sai tối đa trong một câu đoán chữ. Đoán sai không bị cộng nét (chỉ bị trừ điểm);
 * hết lượt sai hoặc hết giờ mà chưa giải được thì +1 nét khi host hiện đáp án.
 */
export const WORD_GUESS_MAX_WRONG = 5;

/**
 * Áp dụng một chữ cái đoán (đã chuẩn hoá A–Z). Mở mọi vị trí có cùng chữ gốc, hiển thị có dấu.
 * Sai đến lượt thứ `maxWrong` thì bảng bị khoá (failed).
 */
export function applyGuess(
  state: WordGuessState,
  word: string,
  letter: string,
  maxWrong = WORD_GUESS_MAX_WRONG,
): { state: WordGuessState; outcome: GuessOutcome } {
  if (state.solved || state.failed) return { state, outcome: "CLOSED" };
  if (state.guessed.includes(letter)) return { state, outcome: "REPEAT" };

  const chars = [...word.toUpperCase()];
  const guessed = [...state.guessed, letter];
  let hit = false;
  const board = chars.map((ch, i) => {
    if (baseLetter(ch) === letter) {
      hit = true;
      return ch;
    }
    return state.board[i] ?? (baseLetter(ch) ? "_" : ch);
  });

  if (!hit) {
    const wrong = [...state.wrong, letter];
    return { state: { ...state, guessed, wrong, failed: wrong.length >= maxWrong }, outcome: "MISS" };
  }
  return { state: { ...state, guessed, board, solved: !board.includes("_") }, outcome: "HIT" };
}
