import type { Player } from "../types";
import Hangman, { StrokeDots } from "./Hangman";

interface Props {
  players: (Player & { uid: string })[];
  highlightUid?: string;
  limit?: number;
  showFigures?: boolean;
}

/** Biểu tượng trạng thái cạnh tên: 🩹 đã được gói cứu trợ cứu, ☠️ bị treo, ⚰️ bị loại chung cuộc. */
export function StatusBadges({ player }: { player: Pick<Player, "status" | "bailoutUsed"> }) {
  // Người dùng cứu trợ mà vẫn bị treo (trả lời sai) thì không được tính là "đã được cứu".
  const wasRescued = !!player.bailoutUsed && player.status !== "HANGED";
  return (
    <>
      {wasRescued && (
        <span title="Đã được Gói cứu trợ của Nhà nước cứu" className="ml-1">
          🩹
        </span>
      )}
      {player.status === "HANGED" && (
        <span title="Đã bị treo" className="ml-1">
          ☠️
        </span>
      )}
      {player.status === "ELIMINATED" && (
        <span title="Bị loại chung cuộc" className="ml-1 text-sm font-semibold text-coal-600">
          ⚰️ bị loại
        </span>
      )}
    </>
  );
}

export default function Leaderboard({ players, highlightUid, limit, showFigures = false }: Props) {
  const list = limit ? players.slice(0, limit) : players;
  return (
    <ol className="space-y-2">
      {list.map((p, i) => {
        const eliminated = p.status === "ELIMINATED";
        return (
          <li
            key={p.uid}
            className={`slide-up flex items-center gap-3 rounded-xl px-4 py-2 ${
              p.uid === highlightUid ? "bg-gold-500/20 ring-2 ring-gold-400" : "bg-coal-800/80"
            } ${eliminated ? "opacity-40 grayscale" : ""}`}
            style={{ animationDelay: `${Math.min(i, 15) * 0.04}s` }}
          >
            <span className="w-8 text-center font-display text-xl text-gold-400">{i + 1}</span>
            {showFigures && (
              <Hangman
                strokes={p.strokes}
                rescued={!!p.bailoutUsed && p.status === "ALIVE"}
                eliminated={eliminated}
                className="h-12 w-10 shrink-0 text-gold-300"
                ghost={false}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold">
                {p.nickname}
                <StatusBadges player={p} />
                {p.online === false && <span className="ml-1 text-xs font-normal text-coal-600">(mất kết nối)</span>}
              </span>
              <StrokeDots strokes={p.strokes} className="mt-1" />
            </span>
            <span className="font-display text-xl text-gold-300">{p.score.toLocaleString("vi-VN")}</span>
          </li>
        );
      })}
    </ol>
  );
}
