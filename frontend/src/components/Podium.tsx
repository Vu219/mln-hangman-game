import { useEffect, useMemo, useState } from "react";
import type { Player } from "../types";
import { sfx } from "../lib/sound";
import Hangman from "./Hangman";
import Leaderboard, { StatusBadges } from "./Leaderboard";

type Ranked = Player & { uid: string };
type Place = 1 | 2 | 3;

const SLOTS: { place: Place; height: string; color: string; medal: string }[] = [
  { place: 2, height: "h-40", color: "from-zinc-300 to-zinc-500", medal: "🥈" },
  { place: 1, height: "h-56", color: "from-gold-300 to-gold-600", medal: "🥇" },
  { place: 3, height: "h-28", color: "from-amber-600 to-amber-900", medal: "🥉" },
];

/** Thời gian trống dồn trước khi xướng từng hạng (ms) – hạng càng cao càng hồi hộp. */
const DRUM_MS: Record<Place, number> = { 3: 2200, 2: 2600, 1: 3600 };
const PAUSE_MS = 1500;

interface Props {
  players: Ranked[];
  highlightUid?: string;
  /** Phát trống dồn / kèn (chỉ bật trên màn hình host để các điện thoại không kêu loạn). */
  sound?: boolean;
}

/** Bục Top 3 (hạng 2 – 1 – 3): xướng tên lần lượt hạng 3 → 2 → 1, sau đó là bảng xếp hạng đầy đủ. */
export default function Podium({ players, highlightUid, sound = false }: Props) {
  const [revealed, setRevealed] = useState<Place[]>([]);
  const [drumming, setDrumming] = useState<Place | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const order = ([3, 2, 1] as Place[]).filter((p) => players[p - 1]);
    const timers: number[] = [];
    let t = 800;
    for (const place of order) {
      const drumAt = t;
      const revealAt = t + DRUM_MS[place];
      timers.push(
        window.setTimeout(() => {
          setDrumming(place);
          if (sound) sfx.drumroll(DRUM_MS[place] / 1000);
        }, drumAt),
        window.setTimeout(() => {
          setDrumming(null);
          setRevealed((r) => [...r, place]);
          if (sound) sfx.place(place);
        }, revealAt),
      );
      t = revealAt + PAUSE_MS;
    }
    timers.push(window.setTimeout(() => setShowAll(true), t + 2000));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // Chỉ chạy một lần khi vào màn hình kết thúc.
  }, []);

  const confetti = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.5,
        duration: 2.5 + Math.random() * 2.5,
        color: ["#e8b021", "#dc3a3a", "#f6ead0", "#93131d"][i % 4],
      })),
    [],
  );

  return (
    <div className="relative">
      {revealed.includes(1) && (
        <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
          {confetti.map((c, i) => (
            <span
              key={i}
              className="confetti"
              style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.duration}s` }}
            />
          ))}
        </div>
      )}

      <p className="mb-4 h-10 text-center text-2xl font-extrabold text-gold-300">
        {drumming ? <span className="animate-pulse">🥁 Hạng {drumming} thuộc về…</span> : revealed.includes(1) ? "🏆 Xin chúc mừng!" : ""}
      </p>

      <div className="mx-auto flex max-w-3xl items-end justify-center gap-3 sm:gap-6">
        {SLOTS.map((slot) => {
          const p = players[slot.place - 1];
          const shown = revealed.includes(slot.place);
          return (
            <div key={slot.place} className="flex w-1/3 max-w-[220px] flex-col items-center">
              {p && shown ? (
                <div className={`podium-drop flex flex-col items-center ${p.status === "ELIMINATED" ? "opacity-40 grayscale" : ""}`}>
                  <Hangman
                    strokes={p.strokes}
                    rescued={!!p.bailoutUsed && p.status === "ALIVE"}
                    eliminated={p.status === "ELIMINATED"}
                    className="h-24 w-20 text-gold-300 sm:h-32 sm:w-28"
                  />
                  <span className="text-3xl">{slot.medal}</span>
                  <span
                    className={`max-w-full truncate text-center text-lg font-extrabold sm:text-2xl ${
                      p.uid === highlightUid ? "text-gold-300 underline" : ""
                    }`}
                  >
                    {p.nickname}
                    <StatusBadges player={p} />
                  </span>
                  <span className="font-display text-gold-400 sm:text-xl">{p.score.toLocaleString("vi-VN")}</span>
                </div>
              ) : (
                <div className={`flex h-32 items-end pb-2 font-display text-6xl text-gold-300/40 ${drumming === slot.place ? "animate-bounce text-gold-300" : ""}`}>
                  {p ? "?" : ""}
                </div>
              )}
              <div
                key={shown ? "on" : "off"}
                className={`mt-2 flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b ${slot.color} ${slot.height} ${
                  shown ? "podium-rise" : "opacity-20 grayscale"
                } ${drumming === slot.place ? "animate-pulse opacity-50" : ""}`}
              >
                <span className="mt-3 font-display text-5xl text-coal-950/70">{slot.place}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`mx-auto mt-8 max-w-2xl transition-opacity duration-700 ${showAll ? "opacity-100" : "opacity-0"}`}>
        {showAll && (
          <>
            <h2 className="title-display mb-3 text-center text-2xl">Bảng xếp hạng</h2>
            <Leaderboard players={players} highlightUid={highlightUid} showFigures />
          </>
        )}
      </div>
    </div>
  );
}
