import { BLANK_MARK, type Question, type QuestionType } from "./schema";
import { answersMatch } from "./text";
import { maskWord, WORD_GUESS_MAX_WRONG } from "./wordGuess";

export type Rng = () => number;

/** Câu hỏi công khai gửi xuống client – ĐÃ LOẠI BỎ đáp án. */
export interface PublicQuestion {
  index: number;
  total: number;
  id: string;
  round: number;
  type: QuestionType;
  prompt: string;
  timeLimitSec: number;
  /** Khoá lượt hỏi (xem slotKey) để client ghép đúng câu. */
  slot: string;
  /** Chỉ có ở câu "Gói cứu trợ của Nhà nước": số vòng vừa kết thúc. */
  bailoutRound?: number;
  options?: string[];
  pattern?: string[];
  letterCount?: number;
  /** Câu đoán chữ: số lượt đoán sai tối đa. */
  maxWrong?: number;
  hint?: string;
  left?: string[];
  right?: string[];
  items?: string[];
  blankCount?: number;
}

/** Đáp án được công khai khi host bấm "Hiện đáp án". */
export interface RevealData {
  explanation: string;
  answerIndex?: number;
  answer?: boolean;
  word?: string;
  pairs?: { left: string; right: string }[];
  order?: string[];
  blanks?: string[];
}

export function shuffle<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Xáo trộn nhưng đảm bảo khác thứ tự gốc (nếu có thể) – để câu sắp xếp không lộ đáp án. */
function shuffleDifferent<T>(arr: readonly T[], rng: Rng): T[] {
  for (let attempt = 0; attempt < 10; attempt++) {
    const out = shuffle(arr, rng);
    if (out.some((v, i) => v !== arr[i])) return out;
  }
  return [...arr].reverse();
}

export function toPublicQuestion(q: Question, index: number, total: number, rng: Rng = Math.random): PublicQuestion {
  const base: PublicQuestion = {
    index,
    total,
    id: q.id,
    round: q.round,
    type: q.type,
    prompt: q.prompt,
    timeLimitSec: q.timeLimitSec,
    slot: String(index),
  };
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return { ...base, options: [...q.options] };
    case "TRUE_FALSE":
      return base;
    case "WORD_GUESS": {
      const pattern = maskWord(q.word);
      return {
        ...base,
        pattern,
        letterCount: pattern.filter((c) => c === "_").length,
        maxWrong: WORD_GUESS_MAX_WRONG,
        ...(q.hint ? { hint: q.hint } : {}),
      };
    }
    case "MATCHING":
      return {
        ...base,
        left: q.pairs.map((p) => p.left),
        right: shuffleDifferent(
          q.pairs.map((p) => p.right),
          rng,
        ),
      };
    case "ORDERING":
      return { ...base, items: shuffleDifferent(q.items, rng) };
    case "FILL_BLANK":
      return { ...base, blankCount: q.prompt.split(BLANK_MARK).length - 1 };
  }
}

export function toRevealData(q: Question): RevealData {
  const explanation = q.explanation ?? "";
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return { explanation, answerIndex: q.answerIndex };
    case "TRUE_FALSE":
      return { explanation, answer: q.answer };
    case "WORD_GUESS":
      return { explanation, word: q.word };
    case "MATCHING":
      return { explanation, pairs: q.pairs.map((p) => ({ ...p })) };
    case "ORDERING":
      return { explanation, order: [...q.items] };
    case "FILL_BLANK":
      return { explanation, blanks: q.blanks.map((b) => b[0]) };
  }
}

/** Kết quả chấm một bài nộp. */
export interface Grade {
  correct: boolean;
  /** Số nét bị cộng nếu sai (luôn tối đa 1 nét cho một lần nộp). */
  penalty: number;
  /** Lựa chọn dùng cho thống kê (chỉ số đáp án MC, 0=Đúng/1=Sai với TF). */
  choice?: number;
}

export class AnswerFormatError extends Error {}

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new AnswerFormatError("Bài nộp không hợp lệ.");
  return payload as Record<string, unknown>;
}

function stringArray(value: unknown, maxLen: number): string[] {
  if (!Array.isArray(value) || value.length > maxLen || !value.every((v) => typeof v === "string" && v.length <= 300))
    throw new AnswerFormatError("Bài nộp không đúng định dạng.");
  return value as string[];
}

/** Chấm bài nộp cho mọi dạng câu, trừ WORD_GUESS (chấm theo từng chữ cái ở guessLetter). */
export function gradeSubmission(q: Question, payload: unknown): Grade {
  const p = asRecord(payload);
  switch (q.type) {
    case "MULTIPLE_CHOICE": {
      const choice = p.choice;
      if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= q.options.length)
        throw new AnswerFormatError("Hãy chọn một đáp án.");
      const correct = choice === q.answerIndex;
      return { correct, penalty: correct ? 0 : 1, choice };
    }
    case "TRUE_FALSE": {
      if (typeof p.value !== "boolean") throw new AnswerFormatError("Hãy chọn Đúng hoặc Sai.");
      const correct = p.value === q.answer;
      return { correct, penalty: correct ? 0 : 1, choice: p.value ? 0 : 1 };
    }
    case "MATCHING": {
      const chosen = stringArray(p.pairs, q.pairs.length);
      // Sai bao nhiêu cặp cũng chỉ +1 nét, như mọi dạng câu khác.
      const correct = q.pairs.every((pair, i) => chosen[i] === pair.right);
      return { correct, penalty: correct ? 0 : 1 };
    }
    case "ORDERING": {
      const order = stringArray(p.order, q.items.length);
      const correct = order.length === q.items.length && order.every((item, i) => item === q.items[i]);
      return { correct, penalty: correct ? 0 : 1 };
    }
    case "FILL_BLANK": {
      const answers = stringArray(p.answers, q.blanks.length);
      const correct = q.blanks.every((accepted, i) => accepted.some((a) => answersMatch(answers[i] ?? "", a)));
      return { correct, penalty: correct ? 0 : 1 };
    }
    case "WORD_GUESS":
      throw new AnswerFormatError("Câu đoán chữ được trả lời bằng cách đoán từng chữ cái.");
  }
}
