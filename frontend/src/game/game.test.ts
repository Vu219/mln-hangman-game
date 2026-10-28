import { describe, expect, it } from "vitest";
import defaultQuestions from "../data/questions.json";
import {
  addStrokes,
  answersMatch,
  applyGuess,
  basePoints,
  computePoints,
  computeStats,
  gradeSubmission,
  initialWordGuess,
  isBailoutEligible,
  isEligible,
  maskWord,
  MAX_STROKES,
  nicknameKey,
  normalizeAnswer,
  normalizeGuessLetter,
  parseQuestionSet,
  rankPlayers,
  removeVietnameseTones,
  resolveBailout,
  resolveOutcome,
  shouldOfferBailout,
  slotKey,
  strokeMultiplier,
  streakBonus,
  toPublicQuestion,
  toRevealData,
  WORD_GUESS_MAX_WRONG,
  wrongLetterFactor,
  type AnswerRecord,
  type PlayerState,
  type Question,
} from "./index";

const q = <T extends Question>(partial: Omit<T, "id" | "round" | "prompt" | "timeLimitSec" | "explanation"> & Partial<T>) =>
  ({ id: "q", round: 1, prompt: "?", timeLimitSec: 20, explanation: "", ...partial }) as T;

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  nickname: "A",
  score: 0,
  strokes: 0,
  status: "ALIVE",
  streak: 0,
  ...over,
});

describe("bỏ dấu tiếng Việt", () => {
  it("bỏ dấu cả chữ hoa và chữ thường, Đ -> D", () => {
    expect(removeVietnameseTones("Ư Ứ Ừ Ử Ữ Ự")).toBe("U U U U U U");
    expect(removeVietnameseTones("Đặng đình")).toBe("Dang dinh");
    expect(removeVietnameseTones("Chủ nghĩa tư bản giám sát")).toBe("Chu nghia tu ban giam sat");
    expect(removeVietnameseTones("ĂÂÊÔƠ")).toBe("AAEOO");
  });
  it("normalizeAnswer: không phân biệt hoa thường, gộp khoảng trắng, bỏ dấu câu hai đầu", () => {
    expect(normalizeAnswer("  Công   NGHIỆP. ")).toBe("cong nghiep");
    expect(answersMatch("cong nghiep", "công nghiệp")).toBe(true);
    expect(answersMatch("Dữ Liệu", "du lieu")).toBe(true);
    expect(answersMatch("dữ kiện", "dữ liệu")).toBe(false);
  });
  it("normalizeGuessLetter chỉ chấp nhận đúng 1 chữ cái", () => {
    expect(normalizeGuessLetter("ư")).toBe("U");
    expect(normalizeGuessLetter("Đ")).toBe("D");
    expect(normalizeGuessLetter("ab")).toBeNull();
    expect(normalizeGuessLetter("1")).toBeNull();
    expect(normalizeGuessLetter("")).toBeNull();
    expect(normalizeGuessLetter(5)).toBeNull();
  });
  it("nicknameKey coi 'Tư Bản' và 'tu  ban' là trùng", () => {
    expect(nicknameKey("Tư Bản")).toBe(nicknameKey("tu  ban"));
    expect(nicknameKey("a.b#c$d")).not.toMatch(/[.#$]/);
  });
});

describe("luật 7 nét", () => {
  it("cộng nét và bị treo khi đủ 7", () => {
    expect(MAX_STROKES).toBe(7);
    expect(addStrokes(0, 1)).toEqual({ strokes: 1, status: "ALIVE" });
    expect(addStrokes(6, 1)).toEqual({ strokes: 7, status: "HANGED" });
    expect(addStrokes(5, 4)).toEqual({ strokes: 7, status: "HANGED" });
  });
  it("đã dùng gói cứu trợ mà đủ 7 nét lần nữa thì bị loại chung cuộc", () => {
    expect(addStrokes(6, 1, true)).toEqual({ strokes: 7, status: "ELIMINATED" });
    expect(addStrokes(5, 1, true)).toEqual({ strokes: 6, status: "ALIVE" });
  });
});

describe("tính điểm", () => {
  it("điểm cơ bản theo tốc độ", () => {
    expect(basePoints(0, 20000)).toBe(1000);
    expect(basePoints(10000, 20000)).toBe(750);
    expect(basePoints(20000, 20000)).toBe(500);
    expect(basePoints(99999, 20000)).toBe(500);
    expect(basePoints(-5, 20000)).toBe(1000);
  });
  it("hệ số theo số nét", () => {
    expect(strokeMultiplier(0)).toBe(1.2);
    expect(strokeMultiplier(1)).toBe(1.1);
    expect(strokeMultiplier(2)).toBe(1.1);
    expect(strokeMultiplier(3)).toBe(1);
    expect(strokeMultiplier(6)).toBe(1);
  });
  it("người đã được cứu không còn hệ số nhân", () => {
    expect(strokeMultiplier(0, true)).toBe(1);
    expect(strokeMultiplier(2, true)).toBe(1);
    expect(computePoints(0, 20000, 0, 1, true)).toBe(1000);
    expect(computePoints(0, 20000, 0, 1, false)).toBe(1200);
  });
  it("thưởng chuỗi 100 * (streak - 1)", () => {
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(100);
    expect(streakBonus(5)).toBe(400);
  });
  it("công thức đầy đủ", () => {
    // 0 nét, trả lời ngay, câu đúng đầu tiên: 1000 * 1.2
    expect(computePoints(0, 20000, 0, 1)).toBe(1200);
    // 2 nét, nửa thời gian, chuỗi 3: round(750 * 1.1) + 200
    expect(computePoints(10000, 20000, 2, 3)).toBe(825 + 200);
    // 4 nét, hết giờ, chuỗi 1
    expect(computePoints(20000, 20000, 4, 1)).toBe(500);
  });
});

describe("chấm bài các dạng câu", () => {
  const mc = q<Extract<Question, { type: "MULTIPLE_CHOICE" }>>({ type: "MULTIPLE_CHOICE", options: ["a", "b", "c", "d"], answerIndex: 2 });
  const tf = q<Extract<Question, { type: "TRUE_FALSE" }>>({ type: "TRUE_FALSE", answer: false });
  const match = q<Extract<Question, { type: "MATCHING" }>>({
    type: "MATCHING",
    pairs: [
      { left: "L1", right: "R1" },
      { left: "L2", right: "R2" },
      { left: "L3", right: "R3" },
      { left: "L4", right: "R4" },
    ],
  });
  const order = q<Extract<Question, { type: "ORDERING" }>>({ type: "ORDERING", items: ["1870", "1882", "1890", "1911"] });
  const fill = q<Extract<Question, { type: "FILL_BLANK" }>>({
    type: "FILL_BLANK",
    prompt: "Tư bản ___ là hợp nhất ngân hàng với ___",
    blanks: [["tài chính"], ["công nghiệp", "cong nghiep"]],
  });

  it("MULTIPLE_CHOICE", () => {
    expect(gradeSubmission(mc, { choice: 2 })).toEqual({ correct: true, penalty: 0, choice: 2 });
    expect(gradeSubmission(mc, { choice: 0 })).toEqual({ correct: false, penalty: 1, choice: 0 });
    expect(() => gradeSubmission(mc, { choice: 4 })).toThrow();
    expect(() => gradeSubmission(mc, { choice: "2" })).toThrow();
  });
  it("TRUE_FALSE", () => {
    expect(gradeSubmission(tf, { value: false })).toMatchObject({ correct: true, choice: 1 });
    expect(gradeSubmission(tf, { value: true })).toMatchObject({ correct: false, penalty: 1, choice: 0 });
  });
  it("MATCHING: sai bao nhiêu cặp cũng chỉ +1 nét", () => {
    expect(gradeSubmission(match, { pairs: ["R1", "R2", "R3", "R4"] })).toEqual({ correct: true, penalty: 0 });
    expect(gradeSubmission(match, { pairs: ["R2", "R1", "R3", "R4"] })).toEqual({ correct: false, penalty: 1 });
    expect(gradeSubmission(match, { pairs: ["R4", "R3", "R2", "R1"] })).toEqual({ correct: false, penalty: 1 });
    expect(gradeSubmission(match, { pairs: ["R1"] })).toEqual({ correct: false, penalty: 1 });
    expect(() => gradeSubmission(match, { pairs: [1, 2, 3, 4] })).toThrow();
  });
  it("ORDERING: sai thứ tự +1 nét", () => {
    expect(gradeSubmission(order, { order: ["1870", "1882", "1890", "1911"] })).toEqual({ correct: true, penalty: 0 });
    expect(gradeSubmission(order, { order: ["1882", "1870", "1890", "1911"] })).toEqual({ correct: false, penalty: 1 });
    expect(gradeSubmission(order, { order: ["1870", "1882", "1890"] })).toEqual({ correct: false, penalty: 1 });
  });
  it("FILL_BLANK: bỏ dấu, không phân biệt hoa thường, nhiều đáp án", () => {
    expect(gradeSubmission(fill, { answers: ["TAI CHINH", "Công Nghiệp"] }).correct).toBe(true);
    expect(gradeSubmission(fill, { answers: ["tài chính", "cong  nghiep "] }).correct).toBe(true);
    expect(gradeSubmission(fill, { answers: ["tài chính", "nông nghiệp"] })).toEqual({ correct: false, penalty: 1 });
    expect(gradeSubmission(fill, { answers: ["tài chính"] }).correct).toBe(false);
  });
  it("câu công khai không chứa đáp án", () => {
    const pubs = [mc, tf, match, order, fill].map((x, i) => toPublicQuestion(x, i, 5));
    for (const p of pubs) {
      const json = JSON.stringify(p);
      expect(json).not.toMatch(/answerIndex|"answer"|blanks|pairs/);
    }
    const pm = toPublicQuestion(match, 0, 1);
    expect(pm.left).toEqual(["L1", "L2", "L3", "L4"]);
    expect([...pm.right!].sort()).toEqual(["R1", "R2", "R3", "R4"]);
    expect(pm.right).not.toEqual(["R1", "R2", "R3", "R4"]);
    const po = toPublicQuestion(order, 0, 1);
    expect(po.items).not.toEqual(order.items);
    expect(toPublicQuestion(fill, 0, 1).blankCount).toBe(2);
    expect(toRevealData(fill).blanks).toEqual(["tài chính", "công nghiệp"]);
  });
});

describe("đoán chữ (WORD_GUESS)", () => {
  const word = "Tư bản";
  it("che chữ cái, giữ khoảng trắng", () => {
    expect(maskWord(word)).toEqual(["_", "_", " ", "_", "_", "_"]);
    const wg = q<Extract<Question, { type: "WORD_GUESS" }>>({ type: "WORD_GUESS", word: "NỀN TẢNG" });
    const pub = toPublicQuestion(wg, 0, 1);
    expect(pub.pattern).toEqual(["_", "_", "_", " ", "_", "_", "_", "_"]);
    expect(pub.letterCount).toBe(7);
    expect(JSON.stringify(pub)).not.toContain("NỀN");
  });
  it("đoán U mở cả Ư, hiển thị có dấu", () => {
    const s0 = initialWordGuess(3, word);
    const { state, outcome } = applyGuess(s0, word, "U");
    expect(outcome).toBe("HIT");
    expect(state.board).toEqual(["_", "Ư", " ", "_", "_", "_"]);
    expect(state.solved).toBe(false);
  });
  it("Đ khớp D", () => {
    const { state } = applyGuess(initialWordGuess(0, "ĐỘC QUYỀN"), "ĐỘC QUYỀN", "D");
    expect(state.board[0]).toBe("Đ");
  });
  it("chữ sai, chữ lặp, giải xong", () => {
    let s = initialWordGuess(0, word);
    let r = applyGuess(s, word, "Z");
    expect(r.outcome).toBe("MISS");
    expect(r.state.wrong).toEqual(["Z"]);
    expect(applyGuess(r.state, word, "Z").outcome).toBe("REPEAT");
    s = r.state;
    for (const l of ["T", "U", "B", "A", "N"]) s = applyGuess(s, word, l).state;
    expect(s.solved).toBe(true);
    expect(s.board.join("")).toBe("TƯ BẢN");
    r = applyGuess(s, word, "K");
    expect(r.outcome).toBe("CLOSED");
  });
  it("sai đến lượt thứ 5 thì khoá bảng", () => {
    expect(WORD_GUESS_MAX_WRONG).toBe(5);
    let s = initialWordGuess(0, word);
    for (const l of ["Q", "W", "Z", "J"]) s = applyGuess(s, word, l).state;
    expect(s.failed).toBe(false);
    s = applyGuess(s, word, "K").state;
    expect(s).toMatchObject({ failed: true, solved: false });
    expect(s.wrong).toHaveLength(5);
    expect(applyGuess(s, word, "T").outcome).toBe("CLOSED");
  });
  it("trừ điểm theo số chữ sai, không âm", () => {
    expect(wrongLetterFactor(0)).toBe(1);
    expect(wrongLetterFactor(3)).toBeCloseTo(0.7);
    expect(wrongLetterFactor(12)).toBe(0);
    expect(computePoints(0, 60000, 0, 1, false, 2)).toBe(Math.round(1000 * 1.2 * 0.8));
  });
});

describe("kết quả khi hiện đáp án", () => {
  const mc = q<Extract<Question, { type: "MULTIPLE_CHOICE" }>>({ type: "MULTIPLE_CHOICE", options: ["a", "b", "c", "d"], answerIndex: 0 });
  const rec = (over: Partial<AnswerRecord>): AnswerRecord => ({ kind: "SUBMIT", correct: false, penalty: 1, at: 0, ...over });

  it("đúng: cộng điểm, tăng chuỗi, cộng thời gian trả lời", () => {
    const { player: p, result } = resolveOutcome("0", player({ streak: 1, strokes: 1 }), rec({ correct: true, penalty: 0, elapsedMs: 0 }), 20000);
    expect(result.points).toBe(1100 + 100);
    expect(p).toMatchObject({ score: 1200, streak: 2, correctCount: 1, strokes: 1, totalAnswerMs: 0 });
  });
  it("sai: +1 nét, mất chuỗi", () => {
    const { player: p, result } = resolveOutcome("0", player({ streak: 3, strokes: 2 }), rec({ elapsedMs: 4000 }), 20000);
    expect(p).toMatchObject({ strokes: 3, streak: 0, totalAnswerMs: 4000 });
    expect(result.strokesAdded).toBe(1);
  });
  it("không trả lời: +1 nét, tính đủ thời gian; đủ 7 nét thì bị treo", () => {
    const { player: p, result } = resolveOutcome("0", player({ strokes: 6 }), rec({ kind: "NO_ANSWER" }), 20000);
    expect(p).toMatchObject({ status: "HANGED", totalAnswerMs: 20000 });
    expect(result.hangedNow).toBe(true);
    expect(result.answered).toBe(false);
  });
  it("người đã được cứu đủ 7 nét lần nữa: ELIMINATED", () => {
    const rescued = player({ strokes: 6, bailoutUsed: true });
    const { player: p, result } = resolveOutcome("5", rescued, rec({}), 20000);
    expect(p.status).toBe("ELIMINATED");
    expect(result.eliminatedNow).toBe(true);
    expect(result.hangedNow).toBe(false);
  });
  it("người đã được cứu trả lời đúng không được nhân hệ số", () => {
    const { result } = resolveOutcome("5", player({ strokes: 6, bailoutUsed: true }), rec({ correct: true, penalty: 0, elapsedMs: 0 }), 20000);
    expect(result.points).toBe(1000);
  });
  it("người không tham gia giữ nguyên", () => {
    const before = player({ status: "HANGED", strokes: 7 });
    expect(resolveOutcome("0", before, null, 20000).player).toEqual(before);
  });
  it("đoán chữ giải được: mỗi chữ sai trừ 10% điểm tốc độ, không cộng nét", () => {
    const solved = (wrongLetters: number) =>
      resolveOutcome("5", player({ strokes: 3 }), rec({ kind: "WORD_SOLVED", correct: true, penalty: 0, elapsedMs: 0, wrongLetters }), 60000);
    expect(solved(0).result.points).toBe(1000);
    expect(solved(2).result.points).toBe(800);
    expect(solved(4).result).toMatchObject({ points: 600, wrongLetters: 4, strokesAdded: 0 });
    expect(solved(4).player.strokes).toBe(3);
  });
  it("đoán chữ hết lượt sai hoặc hết giờ: chỉ +1 nét", () => {
    const failed = resolveOutcome("5", player({ strokes: 2 }), rec({ kind: "WORD_FAILED", penalty: 1, wrongLetters: 5 }), 60000);
    expect(failed.player.strokes).toBe(3);
    expect(failed.result).toMatchObject({ strokesAdded: 1, wrongLetters: 5, correct: false });
    const timeout = resolveOutcome("5", player({ strokes: 6 }), rec({ kind: "NO_ANSWER" }), 60000);
    expect(timeout.player.status).toBe("HANGED");
    expect(timeout.result.strokesAdded).toBe(1);
  });
  it("thống kê", () => {
    const records = [rec({ choice: 0, correct: true }), rec({ choice: 1 }), rec({ choice: 1 }), rec({ kind: "NO_ANSWER" })];
    const stats = computeStats(mc, records, [player(), player({ status: "HANGED" }), player({ status: "ELIMINATED" })], []);
    expect(stats.counts).toEqual([1, 2, 0, 0]);
    expect(stats).toMatchObject({ eligible: 4, answered: 3, correct: 1, wrong: 2, noAnswer: 1, alive: 1, hanged: 1, eliminated: 1 });
  });
  it("phá hoà: điểm → ít nét → chưa dùng cứu trợ → tổng thời gian ít hơn", () => {
    const ranked = rankPlayers([
      player({ nickname: "E", score: 100, strokes: 1, bailoutUsed: false, totalAnswerMs: 9000 }),
      player({ nickname: "D", score: 100, strokes: 1, bailoutUsed: true, totalAnswerMs: 1000 }),
      player({ nickname: "B", score: 100, strokes: 3 }),
      player({ nickname: "F", score: 100, strokes: 1, bailoutUsed: false, totalAnswerMs: 5000 }),
      player({ nickname: "C", score: 900 }),
    ]);
    expect(ranked.map((p) => p.nickname)).toEqual(["C", "F", "E", "D", "B"]);
  });
});

describe("Gói cứu trợ của Nhà nước", () => {
  const rec = (over: Partial<AnswerRecord>): AnswerRecord => ({ kind: "SUBMIT", correct: false, penalty: 1, at: 0, ...over });
  const hanged = () => player({ status: "HANGED", strokes: 7, score: 800, streak: 0, bailoutUsed: false });

  it("chỉ người HANGED chưa dùng cứu trợ mới đủ điều kiện", () => {
    expect(isBailoutEligible(hanged())).toBe(true);
    expect(isBailoutEligible(player())).toBe(false);
    expect(isBailoutEligible(player({ status: "HANGED", bailoutUsed: true }))).toBe(false);
    expect(isBailoutEligible(player({ status: "ELIMINATED", bailoutUsed: true }))).toBe(false);
    expect(isEligible(hanged())).toBe(false);
    expect(isEligible(player({ status: "ELIMINATED" }))).toBe(false);
  });
  it("đúng: về 6 nét, sống lại, đánh dấu đã dùng, mất chuỗi, không cộng điểm", () => {
    const { player: p, result } = resolveBailout("bailout-1", { ...hanged(), streak: 4 }, rec({ correct: true, penalty: 0 }));
    expect(p).toMatchObject({ status: "ALIVE", strokes: 6, bailoutUsed: true, streak: 0, score: 800 });
    expect(result).toMatchObject({ rescued: true, bailout: true, slot: "bailout-1", points: 0, participated: true });
  });
  it("sai: vẫn bị treo nhưng đã dùng cứu trợ", () => {
    const { player: p, result } = resolveBailout("bailout-1", hanged(), rec({}));
    expect(p).toMatchObject({ status: "HANGED", strokes: 7, bailoutUsed: true, score: 800 });
    expect(result.rescued).toBe(false);
  });
  it("hết giờ / không trả lời: vẫn bị treo nhưng đã dùng cứu trợ", () => {
    const { player: p } = resolveBailout("bailout-2", hanged(), rec({ kind: "NO_ANSWER", penalty: 0 }));
    expect(p).toMatchObject({ status: "HANGED", bailoutUsed: true });
  });
  it("người còn sống hoặc đã dùng cứu trợ không bị ảnh hưởng", () => {
    const alive = player({ strokes: 3 });
    expect(resolveBailout("bailout-1", alive, rec({ correct: true })).player).toEqual(alive);
    const used = player({ status: "HANGED", strokes: 7, bailoutUsed: true });
    expect(resolveBailout("bailout-1", used, rec({ correct: true })).player).toEqual(used);
    expect(resolveBailout("bailout-1", alive, null).result.participated).toBe(false);
  });
  it("chỉ mở cứu trợ khi có người đủ điều kiện, có câu hỏi và không phải vòng cuối", () => {
    const players = [player(), hanged()];
    expect(shouldOfferBailout(players, true, false)).toBe(true);
    expect(shouldOfferBailout(players, true, true)).toBe(false);
    expect(shouldOfferBailout(players, false, false)).toBe(false);
    expect(shouldOfferBailout([player(), player({ status: "HANGED", bailoutUsed: true })], true, false)).toBe(false);
  });
  it("slotKey phân biệt câu thường và lượt cứu trợ", () => {
    expect(slotKey({ currentIndex: 5 })).toBe("5");
    expect(slotKey({ currentIndex: 5, bailoutRound: null })).toBe("5");
    expect(slotKey({ currentIndex: 5, bailoutRound: 1 })).toBe("bailout-1");
  });
});

describe("validate bộ câu hỏi", () => {
  it("bộ câu mặc định hợp lệ, đủ 4 vòng và 7 dạng", () => {
    const result = parseQuestionSet(defaultQuestions);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const qs = result.data.questions;
    expect(new Set(qs.map((x) => x.round))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(qs.map((x) => x.type))).toEqual(
      new Set(["MULTIPLE_CHOICE", "TRUE_FALSE", "WORD_GUESS", "MATCHING", "ORDERING", "FILL_BLANK"]),
    );
    expect(qs.length).toBeGreaterThanOrEqual(20);
    expect(qs.some((x) => "rescue" in x)).toBe(false);
  });
  it("vòng 1–3 có 2 câu cứu trợ (không có WORD_GUESS, mặc định 15 giây), vòng 4 không có", () => {
    const result = parseQuestionSet(defaultQuestions);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const byRound = Object.fromEntries(result.data.rounds.map((r) => [r.round, r.bailoutQuestions]));
    for (const round of [1, 2, 3]) {
      expect(byRound[round]).toHaveLength(2);
      for (const bq of byRound[round]) expect(bq.type).not.toBe("WORD_GUESS");
    }
    expect(byRound[4]).toHaveLength(0);
    expect(byRound[1][0].timeLimitSec).toBe(15);
  });
  it("file cũ dùng RESCUE / rescue bị từ chối, gợi ý chuyển sang bailoutQuestions", () => {
    const legacy = parseQuestionSet({
      questions: [
        { id: "r1", round: 2, type: "TRUE_FALSE", rescue: true, prompt: "x", timeLimitSec: 20, answer: true },
        { id: "r2", round: 3, type: "RESCUE", prompt: "x", timeLimitSec: 20 },
      ],
    });
    expect(legacy.ok).toBe(false);
    if (legacy.ok) return;
    expect(legacy.errors).toHaveLength(2);
    expect(legacy.errors[0]).toMatch(/Câu hỏi #1 \(id "r1"\).*không còn được hỗ trợ.*"bailoutQuestions" của vòng 2/);
    expect(legacy.errors[1]).toMatch(/Câu hỏi #2 \(id "r2"\)/);
  });
  it("câu cứu trợ không được là WORD_GUESS", () => {
    const bad = parseQuestionSet({
      rounds: [{ round: 1, title: "V1", bailoutQuestions: [{ id: "b", type: "WORD_GUESS", prompt: "x", word: "ABC" }] }],
      questions: [{ id: "a", round: 1, type: "TRUE_FALSE", prompt: "x", timeLimitSec: 20, answer: true }],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join("\n")).toContain("Vòng #1 › câu cứu trợ #1");
    expect(bad.errors.join("\n")).toContain("\"type\" không hợp lệ");
  });
  it("báo lỗi tiếng Việt rõ ràng", () => {
    const bad = parseQuestionSet({
      questions: [
        { id: "a", round: 1, type: "MULTIPLE_CHOICE", prompt: "x", timeLimitSec: 20, options: ["1", "2"], answerIndex: 0 },
        { id: "a", round: 1, type: "XYZ", prompt: "x", timeLimitSec: 20 },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join("\n")).toContain("Câu hỏi #1 (id \"a\") › options: cần đúng 4 phần tử");
    expect(bad.errors.join("\n")).toContain("Câu hỏi #2");
    expect(bad.errors.join("\n")).toContain("\"type\" không hợp lệ");
  });
  it("báo lỗi số chỗ trống không khớp và id trùng", () => {
    const bad = parseQuestionSet({
      questions: [
        { id: "a", round: 1, type: "FILL_BLANK", prompt: "x ___ y ___", timeLimitSec: 20, blanks: [["1"]] },
        { id: "a", round: 1, type: "TRUE_FALSE", prompt: "x", timeLimitSec: 20, answer: true },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join("\n")).toMatch(/có 2 chỗ trống/);
    expect(bad.errors.join("\n")).toMatch(/bị trùng/);
  });
  it("báo lỗi JSON hỏng và thiếu trường", () => {
    const broken = parseQuestionSet("{ not json");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toMatch(/^File JSON không hợp lệ/);
    const missing = parseQuestionSet({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]).toBe('Trường "questions": thiếu trường bắt buộc');
  });
});
