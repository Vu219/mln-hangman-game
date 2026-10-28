interface Bar {
  label: string;
  value: number;
  color: string;
  correct?: boolean;
}

/** Biểu đồ cột số người chọn từng đáp án. */
export default function BarChart({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex h-56 items-end justify-center gap-3">
      {bars.map((b, i) => (
        <div key={i} className="flex min-w-0 max-w-[6rem] flex-1 flex-col items-center gap-2">
          <span className="font-display text-3xl text-gold-300">{b.value}</span>
          <div
            className={`podium-rise w-full rounded-t-lg ${b.correct === false ? "opacity-40" : ""}`}
            style={{ height: `${Math.max(6, (b.value / max) * 150)}px`, background: b.color, animationDelay: `${i * 0.08}s` }}
          />
          <span className="flex h-8 items-center gap-1 text-center text-sm font-bold leading-tight">
            {b.correct && <span className="text-green-400">✔</span>}
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
}
