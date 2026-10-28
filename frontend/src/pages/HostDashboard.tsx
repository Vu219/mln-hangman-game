import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { errorMessage } from "../lib/api";
import { createRoom, isAdmin } from "../host/engine";
import defaultQuestionSet from "../data/questions.json";
import { useAuthUser } from "../lib/hooks";
import Brand from "../components/Brand";

const RECENT_KEY = "gtc-recent-rooms";

interface Uploaded {
  name: string;
  data: unknown;
  questions: number;
  title?: string;
}

// File mẫu để host tải về và sửa – đủ 6 dạng câu + câu "Gói cứu trợ của Nhà nước".
const SAMPLE = {
  title: "Bộ câu hỏi của tôi",
  rounds: [
    {
      round: 1,
      title: "Vòng 1",
      subtitle: "Mô tả ngắn",
      theme: "classic",
      // "Gói cứu trợ của Nhà nước" sau vòng này: mọi dạng trừ WORD_GUESS, mặc định 15 giây, chọn ngẫu nhiên 1 câu.
      bailoutQuestions: [
        { id: "b1", type: "TRUE_FALSE", prompt: "Câu cứu trợ đúng/sai?", answer: true, explanation: "" },
        { id: "b2", type: "MULTIPLE_CHOICE", prompt: "Câu cứu trợ trắc nghiệm?", options: ["A", "B", "C", "D"], answerIndex: 1 },
      ],
    },
    { round: 2, title: "Vòng 2", theme: "oil" },
  ],
  questions: [
    { id: "q1", round: 1, type: "MULTIPLE_CHOICE", prompt: "Câu hỏi trắc nghiệm?", timeLimitSec: 20, options: ["A", "B", "C", "D"], answerIndex: 0, explanation: "Giải thích" },
    { id: "q2", round: 1, type: "TRUE_FALSE", prompt: "Mệnh đề đúng hay sai?", timeLimitSec: 15, answer: true, explanation: "" },
    { id: "q3", round: 1, type: "WORD_GUESS", prompt: "Đoán từ khoá", timeLimitSec: 60, word: "ĐỘC QUYỀN", hint: "Gợi ý", explanation: "" },
    {
      id: "q4",
      round: 1,
      type: "MATCHING",
      prompt: "Nối các cặp",
      timeLimitSec: 40,
      pairs: [
        { left: "Trái 1", right: "Phải 1" },
        { left: "Trái 2", right: "Phải 2" },
        { left: "Trái 3", right: "Phải 3" },
        { left: "Trái 4", right: "Phải 4" },
      ],
      explanation: "",
    },
    { id: "q5", round: 1, type: "ORDERING", prompt: "Sắp xếp theo thời gian", timeLimitSec: 40, items: ["Sớm nhất", "Thứ hai", "Thứ ba", "Muộn nhất"], explanation: "" },
    { id: "q6", round: 1, type: "FILL_BLANK", prompt: "Điền vào ___ này", timeLimitSec: 30, blanks: [["chỗ trống", "o trong"]], explanation: "" },
    { id: "q7", round: 2, type: "TRUE_FALSE", prompt: "Câu đầu tiên của vòng 2", timeLimitSec: 20, answer: false, explanation: "" },
  ],
};

function loadRecent(): { pin: string; at: number; title: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function HostDashboard() {
  const { user, ready } = useAuthUser();
  const navigate = useNavigate();
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Quyền host: node /admins/{uid} = true (thêm bằng tay hoặc bằng `npm run set-admins`).
  const [admin, setAdmin] = useState<boolean | null>(null);
  const recent = loadRecent().filter((r) => Date.now() - r.at < 3 * 3600 * 1000);

  useEffect(() => {
    if (ready && !user?.email) navigate("/host/login", { replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    void isAdmin(db, user.uid).then((ok) => alive && setAdmin(ok));
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrors([]);
    try {
      const data = JSON.parse(await file.text());
      setUploaded({ name: file.name, data, questions: Array.isArray(data?.questions) ? data.questions.length : 0, title: data?.title });
    } catch (err) {
      setUploaded(null);
      setErrors([`File "${file.name}" không phải JSON hợp lệ: ${(err as Error).message}`]);
    }
  };

  const create = async () => {
    setBusy(true);
    setErrors([]);
    try {
      if (!user) return;
      const res = await createRoom(db, user.uid, uploaded ? uploaded.data : defaultQuestionSet);
      const list = [{ pin: res.pin, at: Date.now(), title: res.title }, ...loadRecent()].slice(0, 5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      navigate(`/host/${res.pin}`);
    } catch (err) {
      // Lỗi validate có dạng "Bộ câu hỏi không hợp lệ:" rồi mỗi lỗi một dòng bắt đầu bằng "- ".
      const [head, ...lines] = errorMessage(err).split("\n- ");
      setErrors([head, ...lines]);
    } finally {
      setBusy(false);
    }
  };

  const downloadSample = () => {
    const blob = new Blob([JSON.stringify(SAMPLE, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bo-cau-hoi-mau.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!ready || !user?.email) return null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <Brand compact />
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-gold-300/70 sm:inline">{user.email}</span>
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => signOut(auth)}>
            Đăng xuất
          </button>
        </div>
      </header>

      <section className="card space-y-5 p-6">
        <h1 className="title-display text-3xl">Tạo phòng mới</h1>
        {admin === false && (
          <div className="rounded-xl border border-blood-400/60 bg-blood-900/60 p-4 text-sm">
            <p className="font-bold text-blood-400">Tài khoản này chưa có quyền host.</p>
            <p className="mt-1 text-gold-300/90">
              Thêm UID dưới đây vào node <code>/admins</code> của Realtime Database (giá trị <code>true</code>) – xem README, mục “Cấp quyền host”.
            </p>
            <code className="mt-2 block select-all break-all rounded bg-coal-950 px-2 py-1 text-gold-300">{user.uid}</code>
          </div>
        )}
        <div className="rounded-xl border border-coal-600 bg-coal-950/60 p-4">
          <p className="font-bold">Bộ câu hỏi</p>
          {uploaded ? (
            <p className="mt-1 text-gold-300">
              📄 {uploaded.name} – {uploaded.title ?? "không có tiêu đề"} ({uploaded.questions} câu){" "}
              <button className="ml-2 text-sm text-blood-400 underline" onClick={() => setUploaded(null)}>
                bỏ, dùng bộ mặc định
              </button>
            </p>
          ) : (
            <p className="mt-1 text-gold-300/80">Mặc định: “Từ độc quyền dầu mỏ đến độc quyền dữ liệu” – 4 vòng, 24 câu, đủ 6 dạng + 6 câu “Gói cứu trợ của Nhà nước”.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="btn-ghost cursor-pointer px-4 py-2 text-sm">
              Tải lên file JSON khác
              <input type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
            </label>
            <button type="button" className="px-2 text-sm text-gold-300/70 underline" onClick={downloadSample}>
              Tải file mẫu
            </button>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-xl bg-blood-900/70 p-4 text-sm font-semibold text-blood-400">
            {errors.map((e, i) => (
              <p key={i} className={i === 0 ? "mb-1 text-base" : "ml-2"}>
                {i === 0 ? e : `• ${e}`}
              </p>
            ))}
          </div>
        )}

        <button className="btn-gold w-full text-xl" onClick={create} disabled={busy || admin === false}>
          {busy ? "Đang tạo phòng…" : "Tạo phòng & lấy mã PIN"}
        </button>
      </section>

      {recent.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-bold text-gold-300">Phòng gần đây</h2>
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.pin}>
                <Link to={`/host/${r.pin}`} className="flex justify-between rounded-lg bg-coal-800 px-4 py-2 hover:bg-coal-700">
                  <span className="font-display text-gold-400">{r.pin}</span>
                  <span className="text-sm text-gold-300/70">{new Date(r.at).toLocaleTimeString("vi-VN")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
