import { useEffect, useRef } from "react";
import { useCountdown } from "../lib/hooks";
import { sfx } from "../lib/sound";

interface Props {
  deadline: number;
  limitSec: number;
  offset: number;
  size?: "sm" | "lg";
  tick?: boolean;
  onExpire?: () => void;
}

/** Đồng hồ đếm ngược theo deadline của server (đã bù .info/serverTimeOffset). */
export default function Countdown({ deadline, limitSec, offset, size = "sm", tick = false, onExpire }: Props) {
  const remaining = useCountdown(deadline, offset);
  const secs = Math.ceil(remaining / 1000);
  const ratio = Math.max(0, Math.min(1, remaining / (limitSec * 1000)));
  const lastSec = useRef(secs);
  const expired = useRef(false);

  useEffect(() => {
    if (tick && secs !== lastSec.current && secs > 0 && secs <= 5) sfx.tick();
    lastSec.current = secs;
    if (remaining <= 0 && !expired.current) {
      expired.current = true;
      onExpire?.();
    }
    if (remaining > 0) expired.current = false;
  }, [secs, remaining, tick, onExpire]);

  const urgent = secs <= 5;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dim = size === "lg" ? "h-28 w-28 text-5xl" : "h-16 w-16 text-2xl";
  return (
    <div className={`relative ${dim} shrink-0`} role="timer" aria-label={`Còn ${secs} giây`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx={50} cy={50} r={r} stroke="#2a2323" strokeWidth={9} fill="#0f0d0d" />
        <circle
          cx={50}
          cy={50}
          r={r}
          stroke={urgent ? "#dc3a3a" : "#e8b021"}
          strokeWidth={9}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - ratio)}
          style={{ transition: "stroke-dashoffset 0.1s linear" }}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-display ${urgent ? "text-blood-400" : "text-gold-300"}`}>
        {secs}
      </span>
    </div>
  );
}
