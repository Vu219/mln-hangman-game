import { useState, type FormEvent } from "react";
import type { AnswerInputProps } from "./ChoiceInput";

export default function FillBlankInput({ question, disabled, onSubmit }: AnswerInputProps) {
  const count = question.blankCount ?? 1;
  const [answers, setAnswers] = useState<string[]>(() => Array(count).fill(""));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ answers: answers.map((a) => a.trim()) });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {answers.map((a, i) => (
        <label key={i} className="block">
          {count > 1 && <span className="mb-1 block text-sm font-bold text-gold-300">Chỗ trống {i + 1}</span>}
          <input
            className="input"
            value={a}
            maxLength={120}
            autoFocus={i === 0}
            autoComplete="off"
            disabled={disabled}
            placeholder="Nhập câu trả lời…"
            onChange={(e) => setAnswers((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
          />
        </label>
      ))}
      <button type="submit" className="btn-gold w-full" disabled={disabled || answers.some((a) => !a.trim())}>
        Nộp bài
      </button>
      <p className="text-center text-xs text-gold-300/60">Không cần gõ dấu, không phân biệt hoa thường.</p>
    </form>
  );
}
