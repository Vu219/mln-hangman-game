import type { PublicQuestion, RevealData } from "../types";
import { OPTION_STYLES, TF_STYLES } from "./answers/options";
import { PAIR_COLORS } from "./answers/MatchingInput";

interface Props {
  question: PublicQuestion;
  reveal?: RevealData | null;
  /** "screen" cho máy chiếu (chữ to), "phone" cho khán giả trên điện thoại. */
  size?: "screen" | "phone";
}

/** Đề bài (prompt) – với câu điền khuyết thì vẽ các ô trống, hoặc đáp án khi đã công bố. */
export function Prompt({ question, reveal, size = "screen" }: Props) {
  const parts = question.type === "FILL_BLANK" ? question.prompt.split("___") : [question.prompt];
  return (
    <h2 className={`font-extrabold leading-snug ${size === "screen" ? "text-3xl lg:text-4xl 2xl:text-5xl" : "text-xl"}`}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 &&
            (reveal?.blanks ? (
              <span className="pop-in mx-1 rounded-lg bg-emerald-700 px-2 text-white">{reveal.blanks[i]}</span>
            ) : (
              <span className="mx-1 inline-block min-w-[3em] border-b-4 border-gold-400 text-gold-400">
                {parts.length > 2 ? `(${i + 1})` : " "}
              </span>
            ))}
        </span>
      ))}
    </h2>
  );
}

/** Phần thân câu hỏi cho màn hình lớn: đáp án, bảng chữ, cột nối… kèm đáp án đúng khi công bố. */
export default function QuestionDisplay({ question, reveal, size = "screen" }: Props) {
  const big = size === "screen";
  switch (question.type) {
    case "MULTIPLE_CHOICE":
      return (
        <div className={`grid gap-3 ${big ? "grid-cols-2" : "grid-cols-1"}`}>
          {(question.options ?? []).map((opt, i) => {
            const correct = reveal?.answerIndex === i;
            return (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-2xl px-5 py-4 font-bold shadow-lg transition ${OPTION_STYLES[i].className} ${
                  big ? "min-h-[88px] text-2xl 2xl:text-3xl" : "text-base"
                } ${reveal && !correct ? "opacity-30" : ""} ${correct ? "ring-4 ring-white" : ""}`}
              >
                <span className="text-3xl">{OPTION_STYLES[i].shape}</span>
                <span className="flex-1">{opt}</span>
                {correct && <span className="text-3xl">✔</span>}
              </div>
            );
          })}
        </div>
      );
    case "TRUE_FALSE":
      return (
        <div className="grid grid-cols-2 gap-4">
          {TF_STYLES.map((s, i) => {
            const correct = reveal?.answer !== undefined && reveal.answer === (i === 0);
            return (
              <div
                key={s.label}
                className={`flex items-center justify-center gap-3 rounded-2xl font-display shadow-lg ${s.className} ${big ? "h-32 text-5xl" : "h-16 text-2xl"} ${
                  reveal && !correct ? "opacity-30" : ""
                } ${correct ? "ring-4 ring-white" : ""}`}
              >
                {s.label} {correct && "✔"}
              </div>
            );
          })}
        </div>
      );
    case "WORD_GUESS": {
      const chars = reveal?.word ? [...reveal.word.toUpperCase()] : question.pattern ?? [];
      return (
        <div className="space-y-4 text-center">
          <div className="flex flex-wrap justify-center gap-x-2 gap-y-4">
            {chars.map((ch, i) =>
              ch === " " ? (
                <span key={i} className={big ? "w-10" : "w-4"} />
              ) : (
                <span
                  key={i}
                  className={`flex items-end justify-center border-b-4 font-display ${big ? "h-20 w-16 text-6xl" : "h-10 w-8 text-2xl"} ${
                    reveal ? "pop-in border-emerald-500 text-gold-300" : "border-gold-500 text-transparent"
                  }`}
                  style={reveal ? { animationDelay: `${i * 0.06}s` } : undefined}
                >
                  {ch === "_" ? "·" : ch}
                </span>
              ),
            )}
          </div>
          {question.hint && <p className={`text-gold-300/80 ${big ? "text-2xl" : "text-sm"}`}>Gợi ý: {question.hint}</p>}
          {!reveal && <p className={`text-gold-300/60 ${big ? "text-xl" : "text-sm"}`}>{question.letterCount} chữ cái · mỗi người đoán trên bảng riêng · tối đa {question.maxWrong ?? 5} lượt sai</p>}
        </div>
      );
    }
    case "MATCHING": {
      const pairs = reveal?.pairs;
      return (
        <div className={`grid grid-cols-2 gap-3 ${big ? "text-xl lg:text-2xl" : "text-sm"}`}>
          <div className="space-y-2">
            {(pairs?.map((p) => p.left) ?? question.left ?? []).map((l, i) => (
              <div key={l} className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 bg-coal-800 px-4 py-2 font-bold" style={{ borderColor: PAIR_COLORS[i] }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base text-coal-950" style={{ background: PAIR_COLORS[i] }}>
                  {i + 1}
                </span>
                {l}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {(pairs?.map((p) => p.right) ?? question.right ?? []).map((r, i) => (
              <div
                key={r}
                className={`flex min-h-[64px] items-center gap-3 rounded-xl border-2 bg-coal-900 px-4 py-2 font-semibold ${pairs ? "slide-up" : ""}`}
                style={{ borderColor: pairs ? PAIR_COLORS[i] : "#3d3434", animationDelay: `${i * 0.1}s` }}
              >
                {pairs && (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base text-coal-950" style={{ background: PAIR_COLORS[i] }}>
                    {i + 1}
                  </span>
                )}
                {r}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "ORDERING": {
      const list = reveal?.order ?? question.items ?? [];
      return (
        <ol className={`mx-auto max-w-3xl space-y-2 ${big ? "text-2xl" : "text-sm"}`}>
          {list.map((item, i) => (
            <li
              key={item}
              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 font-bold ${reveal ? "slide-up border-emerald-500 bg-emerald-900/40" : "border-coal-600 bg-coal-800"}`}
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500 font-display text-coal-950">
                {reveal ? i + 1 : "?"}
              </span>
              {item}
            </li>
          ))}
        </ol>
      );
    }
    case "FILL_BLANK":
      return (
        <p className={`text-center text-gold-300/70 ${big ? "text-2xl" : "text-sm"}`}>
          {reveal ? "Đáp án đã điền vào chỗ trống ở trên." : `Gõ câu trả lời trên điện thoại (${question.blankCount ?? 1} chỗ trống) · không cần dấu`}
        </p>
      );
  }
}
