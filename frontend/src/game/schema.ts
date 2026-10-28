import { z } from "zod";

/** Bản đồ lỗi tiếng Việt cho zod, để host thấy lỗi dễ hiểu khi upload bộ câu hỏi. */
const viErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined") return { message: "thiếu trường bắt buộc" };
      return { message: `sai kiểu dữ liệu: cần ${typeName(issue.expected)}, nhận được ${typeName(issue.received)}` };
    case z.ZodIssueCode.too_small:
      if (issue.type === "array")
        return { message: issue.exact ? `cần đúng ${issue.minimum} phần tử` : `cần ít nhất ${issue.minimum} phần tử` };
      if (issue.type === "string")
        return { message: Number(issue.minimum) <= 1 ? "không được để trống" : `cần ít nhất ${issue.minimum} ký tự` };
      return { message: `phải lớn hơn hoặc bằng ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === "array")
        return { message: issue.exact ? `cần đúng ${issue.maximum} phần tử` : `tối đa ${issue.maximum} phần tử` };
      if (issue.type === "string") return { message: `tối đa ${issue.maximum} ký tự` };
      return { message: `phải nhỏ hơn hoặc bằng ${issue.maximum}` };
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `"type" không hợp lệ, chỉ chấp nhận: ${issue.options.join(", ")}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `giá trị "${String(issue.received)}" không hợp lệ, chỉ chấp nhận: ${issue.options.join(", ")}` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `có trường lạ: ${issue.keys.join(", ")}` };
    case z.ZodIssueCode.not_finite:
      return { message: "phải là số hữu hạn" };
    default:
      return { message: ctx.defaultError };
  }
};

function typeName(t: string): string {
  const names: Record<string, string> = {
    string: "chuỗi",
    number: "số",
    integer: "số nguyên",
    boolean: "true/false",
    array: "mảng",
    object: "đối tượng",
    null: "null",
    undefined: "không có",
  };
  return names[t] ?? t;
}

const text = (max: number) => z.string().trim().min(1).max(max);

const baseQuestion = {
  id: text(64),
  round: z.number().int().min(1).max(20),
  prompt: text(600),
  timeLimitSec: z.number().int().min(5).max(300),
  explanation: z.string().max(1500).default(""),
};

export const multipleChoiceSchema = z.object({
  ...baseQuestion,
  type: z.literal("MULTIPLE_CHOICE"),
  options: z.array(text(160)).length(4),
  answerIndex: z.number().int().min(0).max(3),
});

export const trueFalseSchema = z.object({
  ...baseQuestion,
  type: z.literal("TRUE_FALSE"),
  answer: z.boolean(),
});

export const wordGuessSchema = z.object({
  ...baseQuestion,
  type: z.literal("WORD_GUESS"),
  word: text(40),
  hint: z.string().max(200).optional(),
});

export const matchingSchema = z.object({
  ...baseQuestion,
  type: z.literal("MATCHING"),
  pairs: z.array(z.object({ left: text(120), right: text(160) })).min(2).max(6),
});

export const orderingSchema = z.object({
  ...baseQuestion,
  type: z.literal("ORDERING"),
  items: z.array(text(160)).min(3).max(8),
});

export const fillBlankSchema = z.object({
  ...baseQuestion,
  type: z.literal("FILL_BLANK"),
  blanks: z.array(z.array(text(120)).min(1)).min(1).max(5),
});

export const questionSchema = z.discriminatedUnion("type", [
  multipleChoiceSchema,
  trueFalseSchema,
  wordGuessSchema,
  matchingSchema,
  orderingSchema,
  fillBlankSchema,
]);

/** Mặc định thời gian cho câu "Gói cứu trợ của Nhà nước". */
export const BAILOUT_TIME_LIMIT_SEC = 15;

// Câu cứu trợ: mọi dạng trừ WORD_GUESS, không cần "round" (thuộc về vòng chứa nó), mặc định 15 giây.
const bailoutTime = { timeLimitSec: z.number().int().min(5).max(300).default(BAILOUT_TIME_LIMIT_SEC) };

export const bailoutQuestionSchema = z.discriminatedUnion("type", [
  multipleChoiceSchema.omit({ round: true }).extend(bailoutTime),
  trueFalseSchema.omit({ round: true }).extend(bailoutTime),
  matchingSchema.omit({ round: true }).extend(bailoutTime),
  orderingSchema.omit({ round: true }).extend(bailoutTime),
  fillBlankSchema.omit({ round: true }).extend(bailoutTime),
]);

export const roundInfoSchema = z.object({
  round: z.number().int().min(1).max(20),
  title: text(120),
  subtitle: z.string().max(300).optional(),
  theme: z.enum(["classic", "oil", "network"]).optional(),
  bailoutQuestions: z.array(bailoutQuestionSchema).max(20).default([]),
});

export const BLANK_MARK = "___";

type AnyQuestion = z.infer<typeof questionSchema> | z.infer<typeof bailoutQuestionSchema>;

function checkQuestion(q: AnyQuestion, at: (...rest: (string | number)[]) => (string | number)[], ctx: z.RefinementCtx) {
  if (q.type === "FILL_BLANK") {
    const marks = q.prompt.split(BLANK_MARK).length - 1;
    if (marks !== q.blanks.length)
      ctx.addIssue({
        code: "custom",
        path: at("prompt"),
        message: `có ${marks} chỗ trống "${BLANK_MARK}" nhưng "blanks" có ${q.blanks.length} phần tử`,
      });
  }
  if (q.type === "WORD_GUESS" && !/\p{L}/u.test(q.word))
    ctx.addIssue({ code: "custom", path: at("word"), message: "từ cần đoán phải có ít nhất 1 chữ cái" });
  if (q.type === "MATCHING") {
    if (new Set(q.pairs.map((p) => p.left)).size !== q.pairs.length)
      ctx.addIssue({ code: "custom", path: at("pairs"), message: "vế trái của các cặp bị trùng nhau" });
    if (new Set(q.pairs.map((p) => p.right)).size !== q.pairs.length)
      ctx.addIssue({ code: "custom", path: at("pairs"), message: "vế phải của các cặp bị trùng nhau" });
  }
  if (q.type === "ORDERING" && new Set(q.items).size !== q.items.length)
    ctx.addIssue({ code: "custom", path: at("items"), message: "các mục cần sắp xếp bị trùng nhau" });
}

export const questionSetSchema = z
  .object({
    title: z.string().max(200).optional(),
    rounds: z.array(roundInfoSchema).max(20).default([]),
    questions: z.array(questionSchema).min(1).max(100),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<string>();
    const checkId = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", path, message: `id "${id}" bị trùng` });
      seen.add(id);
    };
    set.questions.forEach((q, i) => {
      const at = (...rest: (string | number)[]) => ["questions", i, ...rest];
      checkId(q.id, at("id"));
      checkQuestion(q, at, ctx);
    });
    set.rounds.forEach((r, ri) =>
      r.bailoutQuestions.forEach((q, i) => {
        const at = (...rest: (string | number)[]) => ["rounds", ri, "bailoutQuestions", i, ...rest];
        checkId(q.id, at("id"));
        checkQuestion(q, at, ctx);
      }),
    );
  });

export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question["type"];
export type QuestionSet = z.infer<typeof questionSetSchema>;
export type RoundInfo = z.infer<typeof roundInfoSchema>;
export type BailoutQuestion = z.infer<typeof bailoutQuestionSchema>;

/** Câu cứu trợ dùng chung bộ chấm điểm với câu thường (gắn thêm số vòng). */
export function bailoutAsQuestion(q: BailoutQuestion, round: number): Question {
  return { ...q, round } as Question;
}

/**
 * Cơ chế câu RESCUE / cờ "rescue" đã bị bỏ. zod sẽ lặng lẽ bỏ qua trường lạ, nên kiểm tra riêng
 * để báo lỗi rõ ràng và gợi ý chuyển sang "bailoutQuestions".
 */
function legacyRescueErrors(value: unknown): string[] {
  const questions = (value as { questions?: unknown })?.questions;
  if (!Array.isArray(questions)) return [];
  const errors: string[] = [];
  questions.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const q = raw as Record<string, unknown>;
    if (q.type !== "RESCUE" && !("rescue" in q)) return;
    const id = typeof q.id === "string" ? ` (id "${q.id}")` : "";
    const round = typeof q.round === "number" ? ` của vòng ${q.round}` : "";
    errors.push(
      `Câu hỏi #${i + 1}${id}: câu giải cứu (type "RESCUE" / trường "rescue") không còn được hỗ trợ. ` +
        `Hãy chuyển câu này vào mảng "bailoutQuestions"${round} trong "rounds" (bỏ trường "rescue" và "round"; mọi dạng trừ WORD_GUESS, mặc định 15 giây).`,
    );
  });
  return errors;
}

export type ParseResult = { ok: true; data: QuestionSet } | { ok: false; errors: string[] };

/** Validate bộ câu hỏi (object hoặc chuỗi JSON). Trả về danh sách lỗi tiếng Việt. */
export function parseQuestionSet(input: unknown): ParseResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`File JSON không hợp lệ: ${(e as Error).message}`] };
    }
  }
  const legacy = legacyRescueErrors(value);
  if (legacy.length) return { ok: false, errors: legacy };
  const result = questionSetSchema.safeParse(value, { errorMap: viErrorMap });
  if (result.success) return { ok: true, data: result.data };

  const errors = result.error.issues.slice(0, 20).map((issue) => `${describePath(issue.path, value)}: ${issue.message}`);
  if (result.error.issues.length > 20) errors.push(`… và ${result.error.issues.length - 20} lỗi khác`);
  return { ok: false, errors };
}

function describePath(path: (string | number)[], root: unknown): string {
  if (path.length === 0) return "Bộ câu hỏi";
  if (path[0] === "questions" && typeof path[1] === "number") {
    const raw = (root as { questions?: { id?: unknown }[] })?.questions?.[path[1]];
    const id = typeof raw?.id === "string" ? ` (id "${raw.id}")` : "";
    const field = path.slice(2).join(".");
    return `Câu hỏi #${path[1] + 1}${id}${field ? ` › ${field}` : ""}`;
  }
  if (path[0] === "rounds" && typeof path[1] === "number") {
    if (path[2] === "bailoutQuestions" && typeof path[3] === "number") {
      const raw = (root as { rounds?: { bailoutQuestions?: { id?: unknown }[] }[] })?.rounds?.[path[1]]?.bailoutQuestions?.[path[3]];
      const id = typeof raw?.id === "string" ? ` (id "${raw.id}")` : "";
      const field = path.slice(4).join(".");
      return `Vòng #${path[1] + 1} › câu cứu trợ #${path[3] + 1}${id}${field ? ` › ${field}` : ""}`;
    }
    const field = path.slice(2).join(".");
    return `Vòng #${path[1] + 1}${field ? ` › ${field}` : ""}`;
  }
  return `Trường "${path.join(".")}"`;
}
