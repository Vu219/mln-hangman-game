import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { errorMessage } from "../lib/api";
import { useAuthUser } from "../lib/hooks";
import Brand from "../components/Brand";

export default function HostLogin() {
  const { user, ready } = useAuthUser();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && user?.email) navigate("/host", { replace: true });
  }, [ready, user, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate("/host");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-4 py-10">
      <Brand />
      <form onSubmit={submit} className="card space-y-4 p-6">
        <h2 className="text-center text-2xl font-extrabold text-gold-300">Đăng nhập Host</h2>
        <label className="block">
          <span className="mb-1 block font-bold">Email</span>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block font-bold">Mật khẩu</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="rounded-lg bg-blood-800/60 p-3 font-semibold text-blood-400">{error}</p>}
        <button className="btn-gold w-full" disabled={busy}>
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
        <p className="text-center text-sm text-gold-300/60">Chỉ tài khoản có trong /admins của Realtime Database mới tạo được phòng.</p>
      </form>
      <Link to="/" className="text-center text-sm text-gold-300/70 hover:underline">
        ← Về trang người chơi
      </Link>
    </main>
  );
}
