import type { PublicQuestion } from "../../types";
import { OPTION_STYLES, TF_STYLES } from "./options";

export interface AnswerInputProps {
  question: PublicQuestion;
  disabled: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}

export function MultipleChoiceInput({ question, disabled, onSubmit }: AnswerInputProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(question.options ?? []).map((opt, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ choice: i })}
          className={`pop-in flex min-h-[72px] items-center gap-3 rounded-2xl px-4 py-3 text-left text-lg font-bold shadow-lg transition active:scale-95 disabled:opacity-60 ${OPTION_STYLES[i].className}`}
          style={{ animationDelay: `${i * 0.05}s` }}
        >
          <span className="text-2xl">{OPTION_STYLES[i].shape}</span>
          <span>{opt}</span>
        </button>
      ))}
    </div>
  );
}

export function TrueFalseInput({ disabled, onSubmit }: AnswerInputProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {TF_STYLES.map((s, i) => (
        <button
          key={s.label}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ value: i === 0 })}
          className={`pop-in h-36 rounded-2xl font-display text-4xl shadow-lg transition active:scale-95 disabled:opacity-60 ${s.className}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
