import { useEffect, useRef } from "react";
import { useCountdown } from "../lib/hooks";
import { sfx } from "../lib/sound";

interface Props {
  /** Thời điểm (giờ server) bắt đầu được chọn đáp án; null khi host đang đặt giờ. */
  startsAt: number | null;
  offset: number;
  size?: "sm" | "lg";
  sound?: boolean;
}

/** Đếm ngược "Chuẩn bị!" sau khi host bấm câu tiếp, trước khi được chọn đáp án. */
export default function PreCountdown({ startsAt, offset, size = "sm", sound = true }: Props) {
  const remaining = useCountdown(startsAt, offset);
  const pending = !startsAt;
  const secs = pending ? -1 : Math.ceil(remaining / 1000);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (pending || secs === last.current) return;
    if (sound && last.current !== null) secs > 0 ? sfx.count(secs) : sfx.go();
    last.current = secs;
  }, [secs, sound, pending]);

  const big = size === "lg";
  return (
    <div className="flex flex-col items-center gap-2 text-center" role="timer" aria-label={`Bắt đầu sau ${secs} giây`}>
      <p className={`font-extrabold uppercase tracking-widest text-gold-300/80 ${big ? "text-2xl" : "text-base"}`}>Chuẩn bị!</p>
      <div
        className={`flex items-center justify-center rounded-full border-8 border-gold-500 bg-coal-950 font-display text-gold-400 shadow-[0_0_40px_rgba(232,176,33,0.35)] ${
          big ? "h-40 w-40 text-8xl" : "h-28 w-28 text-6xl"
        }`}
      >
        {/* key đổi mỗi giây để chạy lại hiệu ứng nảy */}
        <span key={secs} className="pop-in">
          {pending ? "…" : secs > 0 ? secs : "▶"}
        </span>
      </div>
      <p className={`text-gold-300/70 ${big ? "text-lg" : "text-sm"}`}>Đọc kỹ câu hỏi – đáp án sắp hiện ra</p>
    </div>
  );
}
