import { setMuted, useMuted } from "../lib/sound";

export default function SoundToggle({ className = "" }: { className?: string }) {
  const muted = useMuted();
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      className={`rounded-full border border-gold-600/40 bg-coal-900/70 px-3 py-2 text-lg leading-none ${className}`}
      aria-label={muted ? "Bật âm thanh" : "Tắt âm thanh"}
      title={muted ? "Bật âm thanh" : "Tắt âm thanh"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
