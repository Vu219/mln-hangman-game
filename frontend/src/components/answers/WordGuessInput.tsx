import { useEffect, useRef, useState } from "react";
import { db } from "../../firebase";
import { errorMessage } from "../../lib/api";
import { guessLetter } from "../../lib/playerActions";
import { sfx } from "../../lib/sound";
import type { PublicQuestion, WordGuessState } from "../../types";

// Đoán theo chữ gốc: U mở cả Ư, Ứ, Ừ…; D mở cả Đ.
const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface Props {
  pin: string;
  uid: string;
  question: PublicQuestion;
  /** Bảng đã mở do host chấm (private/{uid}/wordGuess). */
  state: WordGuessState | null;
  /** Các chữ mình đã gửi (submissions/{slot}/{uid}/guesses) – có thể host chưa kịp chấm. */
  sent?: Record<string, number>;
  disabled: boolean;
}

/** Hangman cổ điển: mỗi người có bảng riêng, đoán từng chữ cái; trình duyệt của host mở bảng và chấm. */
export default function WordGuessInput({ pin, uid, question, state, sent, disabled }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = state && state.index === question.index ? state : null;
  const board = mine?.board ?? question.pattern ?? [];
  const guessed = new Set(mine?.guessed ?? []);
  const wrong = new Set(mine?.wrong ?? []);
  const waiting = new Set(Object.keys(sent ?? {}).filter((l) => !guessed.has(l)));
  const closed = !!(mine?.solved || mine?.failed);
  const maxWrong = question.maxWrong ?? 5;
  const missesLeft = Math.max(0, maxWrong - wrong.size);

  // Âm thanh khi host mở bảng: đúng / sai / giải xong.
  const opened = board.filter((c) => c !== "_" && c !== " ").length;
  const prev = useRef({ opened, wrong: wrong.size });
  useEffect(() => {
    if (wrong.size > prev.current.wrong) sfx.wrong();
    else if (opened > prev.current.opened) (mine?.solved ? sfx.correct : sfx.join)();
    prev.current = { opened, wrong: wrong.size };
  }, [opened, wrong.size, mine?.solved]);

  const guess = async (letter: string) => {
    if (guessed.has(letter) || waiting.has(letter) || pending) return;
    setPending(letter);
    setError(null);
    try {
      await guessLetter(db, pin, question.slot, uid, letter);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const keyClass = (letter: string) => {
    if (waiting.has(letter) || pending === letter) return "animate-pulse bg-coal-600 text-gold-300";
    if (!guessed.has(letter)) return "bg-coal-700 text-gold-300 active:bg-gold-500 active:text-coal-950";
    return wrong.has(letter) ? "bg-blood-800 text-blood-400 line-through opacity-60" : "bg-emerald-800 text-emerald-200";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-center gap-x-1.5 gap-y-3" aria-label="Bảng chữ">
        {board.map((ch, i) =>
          ch === " " ? (
            <span key={i} className="w-4" />
          ) : (
            <span
              key={i}
              className={`flex h-12 w-9 items-end justify-center border-b-4 pb-1 font-display text-2xl ${
                ch === "_" ? "border-gold-500 text-transparent" : "pop-in border-emerald-500 text-gold-300"
              }`}
            >
              {ch === "_" ? "·" : ch}
            </span>
          ),
        )}
      </div>
      {question.hint && <p className="text-center text-sm text-gold-300/80">Gợi ý: {question.hint}</p>}

      {/* Lượt đoán sai: hết lượt hoặc hết giờ mà chưa giải được thì +1 nét khi công bố đáp án. */}
      <div className="flex items-center justify-center gap-2" aria-label={`Còn ${missesLeft}/${maxWrong} lượt đoán sai`}>
        <span className="text-sm font-bold text-gold-300/80">Lượt sai:</span>
        {Array.from({ length: maxWrong }, (_, i) => (
          <span
            key={i}
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
              i < wrong.size ? "pop-in border-blood-400 bg-blood-500 text-white" : "border-gold-500/50 text-transparent"
            }`}
          >
            ✕
          </span>
        ))}
      </div>

      {mine?.solved && (
        <p className="pop-in text-center text-2xl font-extrabold text-emerald-400">
          Bạn đã giải xong!{wrong.size > 0 ? ` (−${wrong.size * 10}% điểm vì ${wrong.size} chữ sai)` : ""} Chờ công bố điểm…
        </p>
      )}
      {mine?.failed && (
        <p className="pop-in text-center text-xl font-extrabold text-blood-400">Hết {maxWrong} lượt đoán sai – bạn sẽ bị +1 nét khi công bố đáp án.</p>
      )}
      {!closed && (
        <p className="text-center text-sm text-gold-300/70">
          Đoán sai không bị cộng nét, nhưng mỗi chữ sai trừ 10% điểm. Sai {maxWrong} chữ hoặc hết giờ chưa giải được = +1 nét. · Đoán không
          cần dấu (U khớp Ư, Ứ…)
        </p>
      )}

      <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
        {KEYS.map((letter) => (
          <button
            key={letter}
            type="button"
            disabled={disabled || closed || guessed.has(letter) || waiting.has(letter) || pending !== null}
            onClick={() => guess(letter)}
            className={`h-12 rounded-lg font-display text-xl transition disabled:cursor-not-allowed ${keyClass(letter)}`}
          >
            {letter}
          </button>
        ))}
      </div>
      {error && <p className="text-center font-bold text-blood-400">{error}</p>}
    </div>
  );
}
