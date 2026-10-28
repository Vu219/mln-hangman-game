// Kiểu dữ liệu công khai mà client đọc từ Realtime Database (logic chấm điểm nằm ở src/game).

export type RoomStatus = "LOBBY" | "QUESTION" | "REVEAL" | "ROUND_INTRO" | "BAILOUT" | "FINISHED";
export type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "WORD_GUESS" | "MATCHING" | "ORDERING" | "FILL_BLANK";
/** ALIVE: đang chơi · HANGED: bị treo (khán giả) · ELIMINATED: đã được cứu mà lại đủ 7 nét – bị loại chung cuộc. */
export type PlayerStatus = "ALIVE" | "HANGED" | "ELIMINATED";
export type HangmanTheme = "classic" | "oil" | "network";

export const MAX_STROKES = 7;
export const STROKE_NAMES = ["Giá", "Dây", "Đầu", "Thân", "Tay trái", "Tay phải", "Chân"];

export const BAILOUT_TITLE = "Gói cứu trợ của Nhà nước";
export const BAILOUT_SUBTITLE = "Cứu trợ chỉ trì hoãn, không xóa bỏ mâu thuẫn";

export interface RoundInfo {
  round: number;
  title: string;
  subtitle?: string;
  theme?: HangmanTheme;
}

export interface RoomMeta {
  hostUid: string;
  status: RoomStatus;
  currentIndex: number;
  round: number;
  /** Khoá lượt hỏi đang mở ("5" hoặc "bailout-2"), do host ghi. */
  slot?: string | null;
  /** Server timestamp: bắt đầu được trả lời (sau 5 giây "Chuẩn bị!") và hết giờ. Null trong tích tắc host đang đặt giờ. */
  questionStartedAt?: number | null;
  deadline?: number | null;
  createdAt: number;
  totalQuestions: number;
  title: string;
  roundInfo?: RoundInfo | null;
  /** Khác null khi lượt hiện tại (BAILOUT, hoặc REVEAL ngay sau đó) là gói cứu trợ của vòng này. */
  bailoutRound?: number | null;
}

/** Khoá lượt hỏi: chỉ số câu ("5") hoặc lượt cứu trợ ("bailout-2") – giống src/game/outcome.ts. */
export function slotKey(meta: Pick<RoomMeta, "currentIndex" | "bailoutRound">): string {
  return meta.bailoutRound ? `bailout-${meta.bailoutRound}` : String(meta.currentIndex);
}

export interface RevealData {
  explanation: string;
  answerIndex?: number;
  answer?: boolean;
  word?: string;
  pairs?: { left: string; right: string }[];
  order?: string[];
  blanks?: string[];
}

export interface PublicQuestion {
  index: number;
  total: number;
  slot: string;
  /** Chỉ có ở câu gói cứu trợ. */
  bailoutRound?: number;
  id: string;
  round: number;
  type: QuestionType;
  prompt: string;
  timeLimitSec: number;
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
  reveal?: RevealData;
}

export interface Player {
  nickname: string;
  score: number;
  strokes: number;
  status: PlayerStatus;
  streak: number;
  bailoutUsed?: boolean;
  correctCount?: number;
  totalAnswerMs?: number;
  online?: boolean;
  joinedAt?: number;
}

/** Đã được gói cứu trợ cứu (và chưa bị loại). */
export const isRescued = (p: Pick<Player, "status" | "bailoutUsed">) => !!p.bailoutUsed && p.status === "ALIVE";

export interface QuestionStats {
  eligible?: number;
  answered?: number;
  correct?: number;
  wrong?: number;
  noAnswer?: number;
  counts?: number[];
  alive?: number;
  hanged?: number;
  eliminated?: number;
  newlyHanged?: number;
  newlyEliminated?: number;
  /** Lượt cứu trợ: số người được cứu và danh sách người đủ điều kiện. */
  rescued?: number;
  eligibleUids?: Record<string, boolean>;
}

export interface WordGuessState {
  index: number;
  board?: string[];
  guessed?: string[];
  wrong?: string[];
  solved?: boolean;
  failed?: boolean;
}

export interface LastResult {
  slot: string;
  bailout: boolean;
  participated: boolean;
  answered: boolean;
  correct: boolean;
  points: number;
  strokesAdded: number;
  rescued: boolean;
  hangedNow: boolean;
  eliminatedNow: boolean;
  streak: number;
  /** Câu đoán chữ: số chữ đã đoán sai. */
  wrongLetters?: number;
}

/** Bài nộp của chính mình: rooms/{pin}/submissions/{slot}/{uid} (chỉ mình và host đọc được). */
export interface OwnSubmission {
  payload?: unknown;
  at?: number;
  /** Câu đoán chữ: chữ cái -> server timestamp lúc gửi. */
  guesses?: Record<string, number>;
  graded?: boolean;
}

export interface PrivateState {
  lastResult?: LastResult;
  wordGuess?: WordGuessState;
}

export const TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Trắc nghiệm",
  TRUE_FALSE: "Đúng / Sai",
  WORD_GUESS: "Đoán chữ",
  MATCHING: "Nối cặp",
  ORDERING: "Sắp xếp",
  FILL_BLANK: "Điền khuyết",
};

export function themeForRound(round: number, info?: RoundInfo | null): HangmanTheme {
  if (info?.theme) return info.theme;
  if (round === 2) return "oil";
  if (round === 3) return "network";
  return "classic";
}

/** Xếp hạng (phá hoà): điểm → ít nét hơn → chưa dùng cứu trợ → tổng thời gian trả lời ít hơn → tên. */
export function rankPlayers(players: Record<string, Player> | null | undefined): (Player & { uid: string })[] {
  return Object.entries(players ?? {})
    .map(([uid, p]) => ({ ...p, uid }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.strokes - b.strokes ||
        Number(a.bailoutUsed ?? false) - Number(b.bailoutUsed ?? false) ||
        (a.totalAnswerMs ?? 0) - (b.totalAnswerMs ?? 0) ||
        a.nickname.localeCompare(b.nickname, "vi"),
    );
}
