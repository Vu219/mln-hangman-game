import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Brand from "../components/Brand";
import Hangman from "../components/Hangman";

export default function Home() {
  const [params] = useSearchParams();
  const [pin, setPin] = useState(params.get("pin") ?? "");
  const navigate = useNavigate();
  const valid = /^\d{6}$/.test(pin);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) navigate(`/play/${pin}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-4 py-10">
      <Hangman strokes={7} className="h-40 w-36 text-gold-300" />
      <Brand />
      <form onSubmit={submit} className="card w-full space-y-4 p-5">
        <label className="block">
          <span className="mb-2 block text-center text-lg font-bold text-gold-300">Nhập mã PIN của phòng</span>
          <input
            className="input text-center font-display text-4xl tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="000000"
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-label="Mã PIN"
          />
        </label>
        <button type="submit" className="btn-gold w-full text-xl" disabled={!valid}>
          Vào phòng
        </button>
      </form>
      <Link to="/host/login" className="text-sm font-semibold text-gold-300/70 underline-offset-4 hover:underline">
        Bạn là người dẫn trò chơi? Đăng nhập host →
      </Link>
    </main>
  );
}
