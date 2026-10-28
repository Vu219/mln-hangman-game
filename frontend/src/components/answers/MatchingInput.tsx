import { useState } from "react";
import { sfx } from "../../lib/sound";
import type { AnswerInputProps } from "./ChoiceInput";

export const PAIR_COLORS = ["#e8b021", "#dc3a3a", "#38bdf8", "#34d399", "#c084fc", "#fb923c"];

/** Nối cặp: chạm 1 ô bên trái rồi chạm ô bên phải tương ứng. Chạm ô phải đã nối để gỡ. */
export default function MatchingInput({ question, disabled, onSubmit }: AnswerInputProps) {
  const left = question.left ?? [];
  const right = question.right ?? [];
  const [pairs, setPairs] = useState<(number | null)[]>(() => left.map(() => null)); // trái i -> phải j
  const [active, setActive] = useState<number | null>(0);

  const owner = (j: number) => pairs.findIndex((v) => v === j);
  const complete = pairs.every((v) => v !== null);

  const tapRight = (j: number) => {
    sfx.select();
    const current = owner(j);
    if (active === null) {
      // Không có ô trái nào đang chọn: gỡ cặp này để nối lại.
      if (current !== -1) {
        setPairs((prev) => prev.map((v) => (v === j ? null : v)));
        setActive(current);
      }
      return;
    }
    const next = pairs.map((v) => (v === j ? null : v));
    next[active] = j;
    setPairs(next);
    const firstEmpty = next.findIndex((v) => v === null);
    setActive(firstEmpty === -1 ? null : firstEmpty);
  };

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-gold-300/80">Chạm khái niệm bên trái, rồi chạm mô tả phù hợp. Sai dù chỉ 1 cặp = +1 nét!</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          {left.map((l, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => {
                sfx.select();
                setActive(i);
              }}
              className={`flex min-h-[68px] w-full items-center gap-2 rounded-xl border-2 bg-coal-800 px-3 py-2 text-left text-sm font-bold ${
                active === i ? "ring-2 ring-gold-300" : ""
              }`}
              style={{ borderColor: pairs[i] !== null || active === i ? PAIR_COLORS[i] : "#3d3434" }}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-coal-950" style={{ background: PAIR_COLORS[i] }}>
                {i + 1}
              </span>
              {l}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {right.map((r, j) => {
            const o = owner(j);
            return (
              <button
                key={j}
                type="button"
                disabled={disabled}
                onClick={() => tapRight(j)}
                className="flex min-h-[68px] w-full items-center gap-2 rounded-xl border-2 bg-coal-900 px-3 py-2 text-left text-xs font-semibold"
                style={o !== -1 ? { borderColor: PAIR_COLORS[o], background: `${PAIR_COLORS[o]}22` } : { borderColor: "#3d3434" }}
              >
                {o !== -1 && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-coal-950" style={{ background: PAIR_COLORS[o] }}>
                    {o + 1}
                  </span>
                )}
                {r}
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="btn-gold w-full"
        disabled={disabled || !complete}
        onClick={() => onSubmit({ pairs: pairs.map((j) => (j === null ? "" : right[j])) })}
      >
        Nộp bài
      </button>
    </div>
  );
}
