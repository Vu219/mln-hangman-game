import { useEffect } from "react";
import { sfx } from "../lib/sound";
import { BAILOUT_TITLE, MAX_STROKES, STROKE_NAMES, type HangmanTheme, type LastResult, type Player } from "../types";
import Hangman, { StrokeDots } from "./Hangman";

/** Thời gian vẽ mỗi nét mới (khớp STEP trong Hangman). */
const STEP_MS = 550;
const DRAW_DELAY_S = 0.6;

type Kind = "safe" | "stroke" | "hanged" | "eliminated";

interface Props {
  player: Player;
  result: LastResult;
  theme: HangmanTheme;
  onClose: () => void;
}

/**
 * Màn hình tình trạng treo cổ sau khi công bố đáp án: vẽ dần các nét vừa bị cộng,
 * rung khi bị thêm nét, "thả cửa sập" khi bị treo, đóng dấu khi bị loại.
 */
export default function HangmanVerdict({ player, result, theme, onClose }: Props) {
  const strokes = player.strokes;
  const before = Math.max(0, strokes - result.strokesAdded);
  const added = strokes - before;
  const kind: Kind = result.eliminatedNow ? "eliminated" : result.hangedNow ? "hanged" : added > 0 ? "stroke" : "safe";
  const doneMs = DRAW_DELAY_S * 1000 + added * STEP_MS;

  // Âm thanh theo từng nét được vẽ, rồi âm chốt kết quả.
  useEffect(() => {
    const timers: number[] = [];
    for (let k = 0; k < added; k++) {
      timers.push(
        window.setTimeout(() => {
          sfx.stroke();
          navigator.vibrate?.(120);
        }, DRAW_DELAY_S * 1000 + k * STEP_MS),
      );
    }
    timers.push(
      window.setTimeout(() => {
        if (kind === "hanged" || kind === "eliminated") {
          sfx.hanged();
          navigator.vibrate?.([200, 80, 400]);
        } else if (kind === "safe") sfx.reveal();
      }, doneMs),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [added, kind, doneMs]);

  const newNames = STROKE_NAMES.slice(before, strokes);
  const left = MAX_STROKES - strokes;
  const figureFx =
    kind === "hanged" ? "verdict-drop" : kind === "eliminated" ? "verdict-drop grayscale" : kind === "stroke" ? "verdict-shake" : "verdict-safe";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tình trạng treo cổ của bạn"
      onClick={onClose}
      className={`fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 overflow-hidden p-6 text-center fade-in ${
        kind === "hanged" ? "verdict-bg-red backdrop-blur-md" : "bg-coal-950/95 backdrop-blur-md"
      }`}
    >
      <p className="text-sm font-bold uppercase tracking-widest text-gold-300/70">Tình trạng của bạn</p>

      <div className="relative">
        <div className={figureFx} style={{ animationDelay: `${doneMs / 1000}s` }}>
          <Hangman
            strokes={strokes}
            theme={theme}
            eliminated={kind === "eliminated" || player.status === "ELIMINATED"}
            drawFrom={before}
            drawDelay={DRAW_DELAY_S}
            className="h-72 w-60 text-gold-300"
          />
        </div>
        {(kind === "hanged" || kind === "eliminated") && (
          <span
            className="stamp-slam absolute left-1/2 top-1/3 whitespace-nowrap rounded-lg border-4 border-blood-400 px-4 py-1 font-display text-4xl text-blood-400"
            style={{ animationDelay: `${doneMs / 1000 + 0.3}s` }}
          >
            {kind === "hanged" ? "BỊ TREO!" : "BỊ LOẠI!"}
          </span>
        )}
      </div>

      <StrokeDots strokes={strokes} className="scale-150" />

      <div className="slide-up space-y-1" style={{ animationDelay: `${doneMs / 1000 + 0.2}s` }}>
        {kind === "safe" && (
          <>
            <p className="title-display text-3xl text-emerald-400">An toàn!</p>
            <p className="text-gold-300/90">
              Không bị thêm nét nào · {strokes}/{MAX_STROKES} nét
            </p>
          </>
        )}
        {kind === "stroke" && (
          <>
            <p className="title-display text-3xl text-blood-400">+{added} nét</p>
            <p className="text-gold-300/90">Vừa vẽ thêm: {newNames.join(", ")}</p>
          </>
        )}
        {kind === "hanged" && (
          <>
            <p className="text-xl font-extrabold text-blood-400">Đủ 7 nét – bạn đã bị treo cổ!</p>
            <p className="text-gold-300/90">
              {player.bailoutUsed ? "Bạn đã dùng gói cứu trợ – giờ là khán giả." : `Chờ “${BAILOUT_TITLE}” cuối vòng để được cứu một lần.`}
            </p>
          </>
        )}
        {kind === "eliminated" && (
          <>
            <p className="text-xl font-extrabold text-blood-400">Đã được cứu một lần mà lại đủ 7 nét ⚰️</p>
            <p className="text-gold-300/90">Bạn bị loại chung cuộc – vẫn giữ điểm trên bảng xếp hạng.</p>
          </>
        )}
        {(kind === "safe" || kind === "stroke") && left > 0 && (
          <p className={`font-bold ${left <= 2 ? "text-blood-400" : "text-gold-300/70"}`}>
            Còn {left} nét nữa là {player.bailoutUsed ? "bị LOẠI" : "bị treo"}
          </p>
        )}
      </div>

      <button type="button" className="btn-ghost mt-2 text-base" onClick={onClose}>
        Xem lại đáp án
      </button>
    </div>
  );
}
