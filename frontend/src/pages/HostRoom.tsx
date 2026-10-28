import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { db } from "../firebase";
import { errorMessage } from "../lib/api";
import {
  deleteRoom,
  endGame,
  ensureQuestionPublished,
  loadSecrets,
  nextQuestion,
  revealAnswer,
  startGame,
  startGrader,
  type HostMeta,
  type HostSecrets,
} from "../host/engine";
import { useAuthUser, useCountdown, useDbValue, useServerOffset, usePrevious } from "../lib/hooks";
import { sfx, useMusic } from "../lib/sound";
import {
  BAILOUT_SUBTITLE,
  BAILOUT_TITLE,
  MAX_STROKES,
  TYPE_LABELS,
  isRescued,
  rankPlayers,
  slotKey,
  themeForRound,
  type Player,
  type PublicQuestion,
  type QuestionStats,
  type RoomMeta,
} from "../types";
import Brand from "../components/Brand";
import Countdown from "../components/Countdown";
import PreCountdown from "../components/PreCountdown";
import Hangman from "../components/Hangman";
import BarChart from "../components/BarChart";
import Leaderboard, { StatusBadges } from "../components/Leaderboard";
import Podium from "../components/Podium";
import SoundToggle from "../components/SoundToggle";
import QuestionDisplay, { Prompt } from "../components/QuestionDisplay";
import { OPTION_STYLES, TF_STYLES } from "../components/answers/options";

export default function HostRoom() {
  const { pin = "" } = useParams();
  const { user, ready } = useAuthUser();
  const navigate = useNavigate();
  const enabled = !!user;
  const meta = useDbValue<RoomMeta>(enabled ? `rooms/${pin}/meta` : null);
  const playersDb = useDbValue<Record<string, Player>>(enabled ? `rooms/${pin}/players` : null);
  const questionDb = useDbValue<PublicQuestion>(enabled ? `rooms/${pin}/currentQuestion` : null);
  const index = meta.value?.currentIndex ?? -1;
  // Lượt hiện tại: câu thường ("5") hoặc gói cứu trợ ("bailout-1").
  const slot = meta.value && index >= 0 ? slotKey(meta.value) : null;
  const statsDb = useDbValue<QuestionStats>(enabled && slot ? `rooms/${pin}/stats/${slot}` : null);
  const offset = useServerOffset();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoReveal, setAutoReveal] = useState(true);
  const revealRequested = useRef<string | null>(null);
  // Bộ câu hỏi đầy đủ (kèm đáp án) – chỉ host đọc được, nạp lại khi tải lại trang.
  const [secrets, setSecrets] = useState<HostSecrets | null>(null);
  const connected = useDbValue<boolean>(".info/connected").value === true;

  const m = meta.value;
  const status = m?.status;
  const players = useMemo(() => rankPlayers(playersDb.value), [playersDb.value]);
  const question: PublicQuestion | null = questionDb.value && questionDb.value.slot === slot ? questionDb.value : null;
  const stats = statsDb.value;
  const theme = themeForRound(m?.round ?? 1, m?.roundInfo);
  const alive = players.filter((p) => p.status === "ALIVE").length;
  const hanged = players.filter((p) => p.status === "HANGED").length;
  const eliminated = players.filter((p) => p.status === "ELIMINATED").length;
  const bailoutSlot = !!m?.bailoutRound;
  // Đang trong lúc trả lời (câu thường hoặc câu cứu trợ).
  const answering = status === "QUESTION" || status === "BAILOUT";

  useEffect(() => {
    if (ready && !user) navigate("/host/login", { replace: true });
  }, [ready, user, navigate]);

  const isHost = !!m && !!user && m.hostUid === user.uid;
  useEffect(() => {
    if (!isHost || secrets) return;
    loadSecrets(db, pin).then(setSecrets, (e) => setError(errorMessage(e)));
  }, [isHost, secrets, pin]);

  const act = useCallback(
    async (fn: "startGame" | "nextQuestion" | "revealAnswer" | "endGame") => {
      if (!secrets) return;
      setBusy(true);
      setError(null);
      try {
        if (fn === "startGame") await startGame(db, pin, secrets);
        else if (fn === "nextQuestion") await nextQuestion(db, pin, secrets);
        else if (fn === "revealAnswer") await revealAnswer(db, pin, secrets);
        else await endGame(db, pin);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [pin, secrets],
  );

  // Trình duyệt của host là nơi chấm điểm: lắng nghe bài nộp của lượt đang mở và chấm ngay.
  const metaRef = useRef<HostMeta | null>(null);
  metaRef.current = (m as HostMeta | null) ?? null;
  const startedAt = m?.questionStartedAt ?? null;
  useEffect(() => {
    const current = metaRef.current;
    if (!isHost || !secrets || !answering || !startedAt || !current) return;
    return startGrader(db, pin, secrets, current, (e) => setError(errorMessage(e)));
  }, [isHost, secrets, answering, slot, startedAt, pin]);

  // Host tải lại trang đúng lúc đang đặt giờ cho câu hỏi: đặt lại cho xong.
  useEffect(() => {
    const current = metaRef.current;
    if (!isHost || !secrets || !answering || startedAt || busy || !current) return;
    const t = window.setTimeout(() => {
      ensureQuestionPublished(db, pin, secrets, current).catch((e) => setError(errorMessage(e)));
    }, 1500);
    return () => window.clearTimeout(t);
  }, [isHost, secrets, answering, startedAt, busy, slot, pin]);

  // Đóng tab giữa ván sẽ dừng chấm điểm – hỏi lại trước khi rời trang.
  const inGame = !!status && status !== "LOBBY" && status !== "FINISHED";
  useEffect(() => {
    if (!inGame) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [inGame]);

  const removeRoom = async () => {
    if (!window.confirm(`Xoá phòng ${pin} và toàn bộ dữ liệu (người chơi, bài nộp, bộ câu hỏi)?`)) return;
    setBusy(true);
    try {
      await deleteRoom(db, pin);
      navigate("/host", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const reveal = useCallback(() => {
    if (!answering || !slot || revealRequested.current === slot) return;
    revealRequested.current = slot;
    void act("revealAnswer");
  }, [act, answering, slot]);

  // Tự hiện đáp án khi mọi người đã trả lời.
  useEffect(() => {
    if (!autoReveal || !answering || !stats?.eligible) return;
    if ((stats.answered ?? 0) >= stats.eligible) {
      const t = window.setTimeout(reveal, 800);
      return () => window.clearTimeout(t);
    }
  }, [autoReveal, answering, stats?.answered, stats?.eligible, reveal]);

  // Âm thanh theo trạng thái
  const prevStatus = usePrevious(status);
  useEffect(() => {
    if (!prevStatus || status === prevStatus) return;
    if (status === "REVEAL") sfx.reveal();
    if (status === "ROUND_INTRO" || status === "BAILOUT") sfx.round();
  }, [status, prevStatus]);
  // Nhạc nền trên máy chiếu: nhạc chờ ở sảnh, nhạc hồi hộp trong lúc mọi người chọn đáp án.
  const inQuestion = answering;
  const untilStart = useCountdown(inQuestion ? m?.questionStartedAt : null, offset);
  const untilDeadline = useCountdown(inQuestion ? m?.deadline : null, offset);
  const preroll = inQuestion && (!m?.questionStartedAt || untilStart > 0);
  const music = useMusic(status === "LOBBY" ? "lobby" : inQuestion && !preroll && untilDeadline > 0 ? "thinking" : null);

  // Tiếng mừng mỗi khi gói cứu trợ cứu thêm được một người.
  const prevRescued = usePrevious(stats?.rescued);
  useEffect(() => {
    if (status === "BAILOUT" && prevRescued !== undefined && (stats?.rescued ?? 0) > prevRescued) sfx.correct();
  }, [status, stats?.rescued, prevRescued]);

  // Tiếng "tinh" mỗi khi có người trả lời (gộp lại nếu nhiều người trả lời cùng lúc).
  const prevAnswered = usePrevious(stats?.answered);
  const lastPop = useRef(0);
  useEffect(() => {
    if (!inQuestion || prevAnswered === undefined || (stats?.answered ?? 0) <= prevAnswered) return;
    if (Date.now() - lastPop.current > 150) {
      lastPop.current = Date.now();
      sfx.answered();
    }
  }, [inQuestion, stats?.answered, prevAnswered]);
  const prevCount = usePrevious(players.length);
  useEffect(() => {
    if (status === "LOBBY" && prevCount !== undefined && players.length > prevCount) sfx.join();
  }, [players.length, prevCount, status]);

  const primary = useMemo(() => {
    switch (status) {
      case "LOBBY":
        return { label: "Bắt đầu ▶", run: () => act("startGame") };
      case "ROUND_INTRO":
        return { label: "Vào câu hỏi ▶", run: () => act("nextQuestion") };
      case "QUESTION":
      case "BAILOUT":
        return { label: "Hiện đáp án", run: reveal };
      case "REVEAL":
        return {
          label: index + 1 >= (m?.totalQuestions ?? 0) ? "Xem kết quả 🏆" : bailoutSlot ? "Sang vòng tiếp ▶" : "Câu tiếp ▶",
          run: () => act("nextQuestion"),
        };
      default:
        return null;
    }
  }, [status, act, reveal, index, m?.totalQuestions, bailoutSlot]);

  // Phím Enter / Space = nút chính (tiện khi cầm bút trình chiếu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "Enter" && e.key !== " ") || busy || !primary) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, button")) return;
      e.preventDefault();
      primary.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, busy]);

  if (!ready || !user || meta.loading) return <Centered>Đang tải phòng…</Centered>;
  if (!m) return <Centered>Không tìm thấy phòng {pin}. <Link to="/host" className="underline">Tạo phòng mới</Link></Centered>;
  if (m.hostUid !== user.uid) return <Centered>Bạn không phải host của phòng này.</Centered>;

  const joinUrl = `${window.location.origin}/play/${pin}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gold-600/20 bg-coal-950/70 px-4 py-2 sm:px-6">
        <Brand compact />
        {status !== "LOBBY" && (
          <div className="flex flex-wrap items-center gap-4 text-lg font-bold">
            <span>
              PIN <span className="font-display text-gold-400">{pin}</span>
            </span>
            {index >= 0 && status !== "FINISHED" && (
              <span className="text-gold-300/80">{bailoutSlot ? `🩹 Cứu trợ sau vòng ${m.bailoutRound}` : `Câu ${index + 1}/${m.totalQuestions}`}</span>
            )}
            <span className="text-emerald-400">🙂 {alive} còn sống</span>
            <span className="text-blood-400">☠️ {hanged} bị treo</span>
            {eliminated > 0 && <span className="text-coal-600">⚰️ {eliminated} bị loại</span>}
          </div>
        )}
        <div className="flex items-center gap-3">
          <span
            className={`flex items-center gap-1.5 text-sm font-bold ${connected ? "text-emerald-400" : "animate-pulse text-blood-400"}`}
            title={connected ? "Đang kết nối Realtime Database" : "Mất kết nối – thao tác sẽ được gửi khi có mạng lại"}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-blood-400"}`} />
            {connected ? "Đã kết nối" : "Mất kết nối"}
          </span>
          <SoundToggle />
        </div>
      </header>
      {status !== "FINISHED" && (
        <div className="bg-gold-500 px-4 py-1.5 text-center text-sm font-extrabold text-coal-950">
          ⚠️ Không đóng tab này trong khi chơi – trình duyệt này đang chấm điểm cho cả phòng.
          {!secrets && " (Đang nạp bộ câu hỏi…)"}
        </div>
      )}

      <main className="flex flex-1 flex-col px-4 py-6 sm:px-8">
        {music.blocked && (
          <button type="button" onClick={music.unlock} className="btn-ghost mx-auto mb-4 animate-pulse text-base">
            🎵 Bấm để bật nhạc
          </button>
        )}
        {status === "LOBBY" && <Lobby pin={pin} joinUrl={joinUrl} players={players} />}

        {status === "ROUND_INTRO" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <Hangman strokes={MAX_STROKES} theme={theme} className="h-56 w-48 text-gold-300" key={`intro-${m.round}`} />
            <p className="round-zoom title-display text-7xl sm:text-8xl">Vòng {m.round}</p>
            <p className="slide-up text-4xl font-extrabold text-gold-300" style={{ animationDelay: "0.4s" }}>
              {m.roundInfo?.title}
            </p>
            {m.roundInfo?.subtitle && (
              <p className="slide-up text-2xl text-gold-300/70" style={{ animationDelay: "0.7s" }}>
                {m.roundInfo.subtitle}
              </p>
            )}
          </div>
        )}

        {(status === "BAILOUT" || (status === "REVEAL" && bailoutSlot)) &&
          (question ? (
            <BailoutView
              meta={m}
              question={question}
              stats={stats}
              players={players}
              preroll={preroll}
              offset={offset}
              revealed={status === "REVEAL"}
              onExpire={() => {
                sfx.timeUp();
                if (autoReveal) window.setTimeout(reveal, 1200);
              }}
            />
          ) : (
            <Centered>Đang chuẩn bị gói cứu trợ…</Centered>
          ))}

        {(status === "QUESTION" || (status === "REVEAL" && !bailoutSlot)) &&
          (question ? (
            <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 lg:grid-cols-[1fr_360px]">
              <section className="space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-gold-500 px-4 py-1 font-bold text-coal-950">{TYPE_LABELS[question.type]}</span>
                  <span className="rounded-full border border-gold-500/50 px-4 py-1 font-bold text-gold-300">
                    Vòng {question.round}: {m.roundInfo?.title}
                  </span>
                </div>
                <Prompt question={question} reveal={question.reveal} />
                {/* Trong lúc đếm ngược "Chuẩn bị!" chỉ hiện đề bài, đáp án hiện sau. */}
                {!preroll && (
                  <div className="pop-in">
                    <QuestionDisplay question={question} reveal={status === "REVEAL" ? question.reveal : null} />
                  </div>
                )}
                {status === "REVEAL" && question.reveal?.explanation && (
                  <div className="slide-up card border-gold-500/50 p-5 text-xl leading-relaxed lg:text-2xl">
                    <span className="mr-2 font-extrabold text-gold-400">💡 Giải thích:</span>
                    {question.reveal.explanation}
                  </div>
                )}
              </section>

              <aside className="space-y-5">
                {preroll ? (
                  <div className="card flex flex-col items-center p-6">
                    <PreCountdown startsAt={m.questionStartedAt ?? null} offset={offset} size="lg" />
                  </div>
                ) : status === "QUESTION" ? (
                  <div className="card flex flex-col items-center gap-4 p-6">
                    <Countdown
                      deadline={m.deadline ?? 0}
                      limitSec={question.timeLimitSec}
                      offset={offset}
                      size="lg"
                      tick
                      onExpire={() => {
                        sfx.timeUp();
                        if (autoReveal) window.setTimeout(reveal, 1200);
                      }}
                    />
                    <p className="text-center text-2xl font-extrabold">
                      <span className="font-display text-4xl text-gold-400">{stats?.answered ?? 0}</span>
                      <span className="text-gold-300/70"> / {stats?.eligible ?? 0}</span>
                      <br />
                      <span className="text-base text-gold-300/70">{question.type === "WORD_GUESS" ? "đã giải xong / hết lượt" : "đã trả lời"}</span>
                    </p>
                    <label className="flex items-center gap-2 text-sm text-gold-300/80">
                      <input type="checkbox" checked={autoReveal} onChange={(e) => setAutoReveal(e.target.checked)} />
                      Tự hiện đáp án khi hết giờ / mọi người đã trả lời
                    </label>
                  </div>
                ) : (
                  <StatsPanel question={question} stats={stats} />
                )}
                <div className="card p-4">
                  <h3 className="mb-3 text-lg font-extrabold text-gold-300">Top 5</h3>
                  <Leaderboard players={players} limit={5} />
                </div>
              </aside>
            </div>
          ) : (
            <Centered>Đang tải câu hỏi…</Centered>
          ))}

        {status === "FINISHED" && (
          <div className="space-y-6">
            <h1 className="title-display text-center text-5xl">Bục vinh danh</h1>
            <Podium players={players} sound />
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/host" className="btn-ghost">
                Tạo phòng mới
              </Link>
              <button type="button" className="btn-red" disabled={busy} onClick={removeRoom}>
                🗑️ Xóa phòng
              </button>
            </div>
            {error && <p className="text-center font-semibold text-blood-400">{error}</p>}
          </div>
        )}
      </main>

      {status !== "FINISHED" && (
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-gold-600/20 bg-coal-950/90 px-4 py-3 backdrop-blur sm:px-8">
          <div className="min-h-[1.5rem] font-semibold text-blood-400">{error}</div>
          <div className="flex flex-wrap gap-3">
            {status !== "LOBBY" && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => window.confirm("Kết thúc trò chơi và hiện bục vinh danh?") && act("endGame")}
              >
                Kết thúc
              </button>
            )}
            {primary && (
              <button className="btn-gold min-w-[220px] text-xl" disabled={busy || !secrets} onClick={primary.run}>
                {busy ? "…" : primary.label}
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-10 text-center text-2xl font-bold text-gold-300">{children}</div>;
}

function Lobby({ pin, joinUrl, players }: { pin: string; joinUrl: string; players: (Player & { uid: string })[] }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 gap-8 lg:grid-cols-[420px_1fr]">
      <section className="card flex flex-col items-center gap-4 p-6 text-center">
        <p className="text-xl font-bold text-gold-300/80">Vào chơi tại</p>
        <p className="break-all text-2xl font-extrabold text-gold-300">{joinUrl.replace(/^https?:\/\//, "").replace(/\/play\/\d+$/, "")}</p>
        <p className="text-xl font-bold text-gold-300/80">với mã PIN</p>
        <p className="font-display text-7xl tracking-widest text-gold-400 drop-shadow-[0_4px_0_#4a0a0f]">{pin}</p>
        <div className="rounded-2xl bg-white p-4">
          <QRCodeSVG value={joinUrl} size={240} level="M" />
        </div>
        <p className="text-sm text-gold-300/60">Quét QR để vào thẳng phòng</p>
      </section>
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between">
          <h2 className="title-display text-4xl">Người chơi</h2>
          <span className="font-display text-4xl text-gold-300">{players.length}/100</span>
        </div>
        {players.length === 0 ? (
          <p className="card animate-pulse p-10 text-center text-2xl text-gold-300/70">Đang chờ người chơi vào phòng…</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {players.map((p) => (
              <li key={p.uid} className="pop-in flex items-center gap-2 rounded-xl bg-coal-800 px-4 py-2 text-2xl font-extrabold">
                <span className={`h-3 w-3 rounded-full ${p.online === false ? "bg-coal-600" : "bg-emerald-400"}`} />
                {p.nickname}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-auto text-lg text-gold-300/70">
          Luật: mỗi người có 7 nét treo cổ. Sai, hết giờ hay không trả lời đều +1 nét. Đủ 7 nét là bị treo – cuối mỗi vòng có
          một lần “Gói cứu trợ của Nhà nước”, nhưng ai đã được cứu mà lại đủ 7 nét sẽ bị loại chung cuộc!
        </p>
      </section>
    </div>
  );
}

function StatsPanel({ question, stats }: { question: PublicQuestion; stats: QuestionStats | null }) {
  const reveal = question.reveal;
  let bars;
  if (question.type === "MULTIPLE_CHOICE") {
    bars = (question.options ?? []).map((_, i) => ({
      label: OPTION_STYLES[i].shape,
      value: stats?.counts?.[i] ?? 0,
      color: OPTION_STYLES[i].hex,
      correct: reveal ? reveal.answerIndex === i : undefined,
    }));
  } else if (question.type === "TRUE_FALSE") {
    bars = TF_STYLES.map((s, i) => ({
      label: s.label,
      value: stats?.counts?.[i] ?? 0,
      color: s.hex,
      correct: reveal?.answer !== undefined ? reveal.answer === (i === 0) : undefined,
    }));
  } else {
    bars = [
      { label: "Đúng", value: stats?.correct ?? 0, color: "#047857" },
      { label: "Sai", value: stats?.wrong ?? 0, color: "#b91c25" },
      { label: "Không kịp", value: stats?.noAnswer ?? 0, color: "#475569" },
    ];
  }
  return (
    <div className="card space-y-4 p-5">
      <BarChart bars={bars} />
      <div className="grid grid-cols-2 gap-2 text-center text-sm font-bold">
        <Stat label="Trả lời đúng" value={stats?.correct ?? 0} className="text-emerald-400" />
        <Stat label="Không trả lời" value={stats?.noAnswer ?? 0} className="text-gold-300/80" />
        <Stat label="Còn sống" value={stats?.alive ?? 0} className="text-emerald-400" />
        <Stat label="Đã bị treo" value={stats?.hanged ?? 0} className="text-blood-400" />
        <Stat label="Vừa bị treo" value={stats?.newlyHanged ?? 0} className="text-blood-400" />
        <Stat label="Vừa bị loại" value={stats?.newlyEliminated ?? 0} className="text-coal-600" />
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-xl bg-coal-800 p-2 ${className}`}>
      <div className="font-display text-3xl">{value}</div>
      <div className="text-xs text-gold-300/70">{label}</div>
    </div>
  );
}

/** Màn hình "Gói cứu trợ của Nhà nước" trên máy chiếu. */
function BailoutView({
  meta,
  question,
  stats,
  players,
  preroll,
  offset,
  revealed,
  onExpire,
}: {
  meta: RoomMeta;
  question: PublicQuestion;
  stats: QuestionStats | null;
  players: (Player & { uid: string })[];
  preroll: boolean;
  offset: number;
  revealed: boolean;
  onExpire: () => void;
}) {
  const eligibleUids = stats?.eligibleUids ?? {};
  const candidates = players.filter((p) => eligibleUids[p.uid]);
  const rescuedCount = candidates.filter(isRescued).length;
  const theme = themeForRound(meta.round, meta.roundInfo);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
      <div className="text-center">
        <p className="round-zoom title-display text-4xl lg:text-6xl">🏛️ {BAILOUT_TITLE}</p>
        <p className="slide-up mt-2 text-xl italic text-gold-300/80 lg:text-2xl" style={{ animationDelay: "0.3s" }}>
          “{BAILOUT_SUBTITLE}”
        </p>
        <p className="mt-1 text-sm text-gold-300/60">
          Sau vòng {meta.bailoutRound} · chỉ người đang bị treo và chưa dùng cứu trợ được trả lời · đúng: về 6 nét, sống lại (không cộng điểm, mất hệ số nhân)
        </p>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-6">
          <span className="rounded-full bg-gold-500 px-4 py-1 font-bold text-coal-950">{TYPE_LABELS[question.type]}</span>
          <Prompt question={question} reveal={question.reveal} />
          {!preroll && (
            <div className="pop-in">
              <QuestionDisplay question={question} reveal={revealed ? question.reveal : null} />
            </div>
          )}
          {revealed && question.reveal?.explanation && (
            <div className="slide-up card border-gold-500/50 p-5 text-xl leading-relaxed">
              <span className="mr-2 font-extrabold text-gold-400">💡 Giải thích:</span>
              {question.reveal.explanation}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <div className="card flex flex-col items-center gap-4 p-6">
            {preroll ? (
              <PreCountdown startsAt={meta.questionStartedAt ?? null} offset={offset} size="lg" />
            ) : (
              !revealed && <Countdown deadline={meta.deadline ?? 0} limitSec={question.timeLimitSec} offset={offset} size="lg" tick onExpire={onExpire} />
            )}
            <p className="text-center font-extrabold">
              <span key={rescuedCount} className="pop-in inline-block font-display text-6xl text-emerald-400">
                {rescuedCount}
              </span>
              <span className="font-display text-4xl text-gold-300/70">/{candidates.length}</span>
              <br />
              <span className="text-xl text-gold-300">đã được cứu</span>
            </p>
          </div>

          <div className="card p-4">
            <h3 className="mb-3 text-lg font-extrabold text-gold-300">Người chờ cứu trợ</h3>
            <ul className="grid grid-cols-2 gap-3">
              {candidates.map((p) => {
                const saved = isRescued(p);
                const failed = !!p.bailoutUsed && !saved;
                return (
                  <li key={p.uid} className={`flex flex-col items-center rounded-xl bg-coal-800 p-2 text-center ${failed ? "opacity-50" : ""}`}>
                    <Hangman strokes={p.strokes} theme={theme} rescued={saved} animateRescue className="h-24 w-20 text-gold-300" ghost={false} />
                    <span className="max-w-full truncate font-bold">
                      {p.nickname}
                      <StatusBadges player={p} />
                    </span>
                    <span className={`text-xs font-bold ${saved ? "text-emerald-400" : failed ? "text-blood-400" : "text-gold-300/70"}`}>
                      {saved ? "Đã được cứu!" : failed ? "Cứu trợ thất bại" : revealed ? "Không kịp trả lời" : "Đang chờ…"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
