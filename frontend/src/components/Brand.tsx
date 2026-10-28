import Hangman from "./Hangman";

export default function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Hangman strokes={7} className="h-9 w-8 text-gold-400" ghost={false} title="Logo" />
        <span className="font-display text-sm leading-tight text-gold-400">
          Giá Treo Cổ
          <br />
          <span className="text-blood-400">Của Tư Bản</span>
        </span>
      </div>
    );
  }
  return (
    <div className="text-center">
      <h1 className="title-display text-4xl leading-tight sm:text-6xl">
        Giá Treo Cổ
        <br />
        <span className="text-blood-400">Của Tư Bản</span>
      </h1>
      <p className="mt-3 text-base font-semibold text-gold-300/80 sm:text-lg">Từ độc quyền dầu mỏ đến độc quyền dữ liệu</p>
    </div>
  );
}
