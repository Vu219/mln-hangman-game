import type { CSSProperties } from "react";
import { MAX_STROKES, STROKE_NAMES, type HangmanTheme } from "../types";

/** Thuộc tính vẽ dần cho một nét (rỗng = hiện sẵn, không animation). */
type DrawProps = { className?: string; style?: CSSProperties };

interface Props {
  strokes: number;
  theme?: HangmanTheme;
  className?: string;
  /** Hiện mờ các nét chưa vẽ để người chơi thấy còn bao nhiêu nét. */
  ghost?: boolean;
  title?: string;
  /** Đã được gói cứu trợ cứu: dây đứt, nhân vật đứng trên mặt đất với băng dán. */
  rescued?: boolean;
  /** Đã được cứu rồi lại đủ 7 nét: bị loại chung cuộc (vẫn còn băng dán). */
  eliminated?: boolean;
  /** Chạy animation dây đứt – nhân vật đứng dậy (khi vừa được cứu). */
  animateRescue?: boolean;
  /**
   * Chỉ vẽ dần các nét có thứ tự >= drawFrom (các nét trước hiện sẵn), lần lượt từng nét.
   * Mặc định 0: mọi nét đều vẽ dần khi xuất hiện.
   */
  drawFrom?: number;
  /** Độ trễ (giây) trước khi bắt đầu vẽ nét đầu tiên trong số các nét mới. */
  drawDelay?: number;
}

// Khoảng hạ nhân vật để chân chạm đất khi được cứu.
const STAND_DROP = 24;

// Toạ độ 7 nét trên khung 200 x 240.
const GALLOWS = "M18 226 H160 M52 226 V22 H142 M52 62 L92 22";
const ROPE = "M142 22 V58";
const BODY = "M142 98 V160";
const ARM_L = "M142 112 L114 142";
const ARM_R = "M142 112 L170 142";
const LEGS = "M142 160 L120 202 M142 160 L164 202";

const PALETTE: Record<HangmanTheme, { gallows: string; rope: string; body: string; accent: string }> = {
  classic: { gallows: "#8a5a2e", rope: "#d9b66a", body: "#f6ead0", accent: "#e8b021" },
  oil: { gallows: "#5b5b66", rope: "#141414", body: "#f5c84c", accent: "#e8b021" },
  network: { gallows: "#0f766e", rope: "#22d3ee", body: "#a5f3fc", accent: "#2dd4bf" },
};

export default function Hangman({
  strokes,
  theme = "classic",
  className = "",
  ghost = true,
  title,
  rescued = false,
  eliminated = false,
  animateRescue = false,
  drawFrom = 0,
  drawDelay = 0,
}: Props) {
  const n = Math.max(0, Math.min(MAX_STROKES, strokes));
  const c = PALETTE[theme];
  const hanged = n >= MAX_STROKES;
  if (rescued && !hanged) return <RescuedFigure theme={theme} className={className} animate={animateRescue} strokes={n} />;
  const show = (i: number) => n > i;
  const STEP = drawFrom > 0 ? 0.55 : 0;
  const draw = (i: number): DrawProps =>
    i >= drawFrom ? { className: "draw-part", style: { animationDelay: `${drawDelay + (i - drawFrom) * STEP}s` } } : {};
  const doneAt = drawDelay + Math.max(0, n - drawFrom) * STEP;
  const label =
    title ?? (eliminated ? "Bị loại chung cuộc" : `${n}/${MAX_STROKES} nét${n > 0 ? `: ${STROKE_NAMES.slice(0, n).join(", ")}` : ""}`);

  return (
    <svg viewBox="0 0 200 240" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      {ghost && (
        <g stroke="currentColor" strokeOpacity={0.12} strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray="6 8">
          {!show(0) && <path d={GALLOWS} />}
          {!show(1) && <path d={ROPE} />}
          {!show(2) && <circle cx={142} cy={78} r={20} />}
          {!show(3) && <path d={BODY} />}
          {!show(4) && <path d={ARM_L} />}
          {!show(5) && <path d={ARM_R} />}
          {!show(6) && <path d={LEGS} />}
        </g>
      )}

      {/* 1. Giá */}
      {show(0) && <Gallows theme={theme} color={c.gallows} accent={c.accent} anim={draw(0)} />}

      {/* 2. Dây */}
      {show(1) && <Rope theme={theme} color={c.rope} accent={c.accent} anim={draw(1)} />}

      <g className={hanged ? "sway" : undefined} style={{ transformOrigin: "142px 22px" }}>
        <g stroke={c.body} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {show(2) && <circle {...draw(2)} pathLength={1} cx={142} cy={78} r={20} />}
          {show(3) && <path {...draw(3)} pathLength={1} d={BODY} />}
          {show(4) && <path {...draw(4)} pathLength={1} d={ARM_L} />}
          {show(5) && <path {...draw(5)} pathLength={1} d={ARM_R} />}
          {show(6) && <path {...draw(6)} pathLength={1} d={LEGS} />}
        </g>
        {show(2) && !hanged && (
          <g fill={c.body} className="fade-in">
            <circle cx={135} cy={75} r={2.4} />
            <circle cx={149} cy={75} r={2.4} />
          </g>
        )}
        {hanged && (
          <g stroke="#dc3a3a" strokeWidth={2.6} strokeLinecap="round" className="fade-in" style={{ animationDelay: `${doneAt}s` }}>
            <path d="M131 71 l7 7 M138 71 l-7 7 M145 71 l7 7 M152 71 l-7 7" />
            <path d="M134 89 q8 -5 16 0" fill="none" />
          </g>
        )}
        {eliminated && <Bandage x={150} y={64} />}
      </g>
    </svg>
  );
}

/** Băng dán chéo trên đầu người đã được cứu. */
function Bandage({ x, y, animate = false }: { x: number; y: number; animate?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(-35)`}>
      <g className={animate ? "bandage-pop" : undefined}>
        <rect x={-11} y={-4} width={22} height={8} rx={3} fill="#f4d3a1" stroke="#a0703a" strokeWidth={1} />
        <rect x={-4} y={-4} width={8} height={8} fill="#e9bf86" />
        <circle cx={-7} cy={0} r={0.9} fill="#a0703a" />
        <circle cx={7} cy={0} r={0.9} fill="#a0703a" />
      </g>
    </g>
  );
}

/**
 * Người đã được gói cứu trợ cứu: dây đứt (đoạn dưới rơi xuống), nhân vật hạ xuống đứng trên mặt đất,
 * băng dán trên đầu. Chân vẽ nét đứt: chỉ còn 1 nét nữa là bị loại.
 */
function RescuedFigure({ theme, className, animate, strokes }: { theme: HangmanTheme; className: string; animate: boolean; strokes: number }) {
  const c = PALETTE[theme];
  return (
    <svg viewBox="0 0 200 240" className={className} role="img" aria-label={`Đã được cứu – ${strokes}/${MAX_STROKES} nét`}>
      <title>{`Đã được gói cứu trợ cứu – ${strokes}/${MAX_STROKES} nét`}</title>
      <Gallows theme={theme} color={c.gallows} accent={c.accent} />
      {/* Đoạn dây còn lại, đầu dây tưa */}
      <path d="M142 22 V36 M142 36 l-3 5 M142 36 l3 5 M142 36 v6" stroke={c.rope} strokeWidth={4} strokeLinecap="round" fill="none" />
      {animate && (
        <path d="M142 40 V58" stroke={c.rope} strokeWidth={4} strokeLinecap="round" className="rope-fall" style={{ transformOrigin: "142px 40px" }} />
      )}
      <g className={animate ? "stand-up" : undefined} style={{ transform: `translateY(${STAND_DROP}px)` }}>
        <g stroke={c.body} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx={142} cy={78} r={20} />
          <path d={BODY} />
          {/* Tay giơ lên mừng rỡ */}
          <path d="M142 112 L116 92 M142 112 L168 92" />
          <path d={LEGS} strokeDasharray="5 6" strokeOpacity={0.55} />
        </g>
        <g fill={c.body}>
          <circle cx={135} cy={75} r={2.4} />
          <circle cx={149} cy={75} r={2.4} />
        </g>
        <path d="M133 85 q9 7 18 0" stroke={c.body} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Bandage x={150} y={64} animate={animate} />
      </g>
    </svg>
  );
}

function Gallows({ theme, color, accent, anim = { className: "draw-part" } }: { theme: HangmanTheme; color: string; accent: string; anim?: DrawProps }) {
  if (theme === "oil") {
    // Giá bằng ống dầu: ống dày có vạch sáng, mặt bích ở các khớp, van tay quay.
    return (
      <g className="fade-in">
        <path d={GALLOWS} stroke="#111" strokeWidth={15} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path {...anim} pathLength={1} d={GALLOWS} stroke={color} strokeWidth={11} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M52 220 V26 H138" stroke="#a1a1aa" strokeWidth={2.5} fill="none" strokeLinecap="round" />
        {[
          [52, 226],
          [52, 22],
          [142, 22],
          [52, 130],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x - 10} y={y - 5} width={20} height={10} rx={2} fill={accent} stroke="#111" strokeWidth={1.5} />
        ))}
        <circle cx={52} cy={170} r={9} fill="none" stroke={accent} strokeWidth={3} />
        <path d="M43 170 h18 M52 161 v18" stroke={accent} strokeWidth={2} />
        <path d="M100 232 q4 -10 8 0 a4 4 0 1 1 -8 0" fill="#0b0b0b" className="drip" />
      </g>
    );
  }
  if (theme === "network") {
    // Giá bằng dây cáp mạng: cáp có dữ liệu chạy, nút mạng ở các khớp.
    return (
      <g className="fade-in">
        <path {...anim} pathLength={1} d={GALLOWS} stroke={color} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d={GALLOWS} stroke={accent} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray="4 10" className="data-flow" />
        {[
          [52, 226],
          [52, 22],
          [142, 22],
          [72, 42],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x - 7} y={y - 7} width={14} height={14} rx={3} fill="#042f2e" stroke={accent} strokeWidth={2} />
        ))}
        <circle cx={52} cy={22} r={2.5} fill="#22d3ee" className="blink" />
      </g>
    );
  }
  return <path {...anim} pathLength={1} d={GALLOWS} stroke={color} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

function Rope({ theme, color, accent, anim = { className: "draw-part" } }: { theme: HangmanTheme; color: string; accent: string; anim?: DrawProps }) {
  if (theme === "oil") {
    return (
      <g>
        <path {...anim} pathLength={1} d={ROPE} stroke={color} strokeWidth={6} strokeLinecap="round" />
        <path d="M142 26 V54" stroke="#3b3b3b" strokeWidth={1.5} className="fade-in" />
        <rect x={136} y={52} width={12} height={6} rx={1} fill={accent} className="fade-in" />
      </g>
    );
  }
  if (theme === "network") {
    return (
      <g>
        <path {...anim} pathLength={1} d={ROPE} stroke={color} strokeWidth={4} strokeLinecap="round" />
        {/* Đầu cắm RJ45 */}
        <g className="fade-in">
          <rect x={135} y={48} width={14} height={11} rx={1.5} fill="#e0f2fe" stroke={accent} strokeWidth={1.5} />
          <path d="M138 51 v5 M141 51 v5 M144 51 v5 M147 51 v5" stroke="#0891b2" strokeWidth={1} />
        </g>
      </g>
    );
  }
  return <path {...anim} pathLength={1} d={ROPE} stroke={color} strokeWidth={4} strokeLinecap="round" />;
}

/** Thanh 7 chấm hiển thị số nét. */
export function StrokeDots({ strokes, className = "" }: { strokes: number; className?: string }) {
  return (
    <div className={`flex gap-1 ${className}`} aria-label={`${strokes}/${MAX_STROKES} nét`}>
      {Array.from({ length: MAX_STROKES }, (_, i) => (
        <span
          key={i}
          title={STROKE_NAMES[i]}
          className={`h-2.5 w-2.5 rounded-full border ${i < strokes ? "border-blood-400 bg-blood-400" : "border-coal-600 bg-transparent"}`}
        />
      ))}
    </div>
  );
}
