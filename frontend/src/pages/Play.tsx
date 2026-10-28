import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";
import { db } from "../firebase";
import { errorMessage } from "../lib/api";
import { joinRoom, submitAnswer } from "../lib/playerActions";
import { useAuthUser, useCountdown, useDbValue, usePresence, usePrevious, useServerOffset, useShakeOnIncrease } from "../lib/hooks";
import { sfx } from "../lib/sound";
import {
  BAILOUT_SUBTITLE,
  BAILOUT_TITLE,
  MAX_STROKES,
  STROKE_NAMES,
  TYPE_LABELS,
  isRescued,
  rankPlayers,
  slotKey,
  themeForRound,
  type HangmanTheme,
  type LastResult,
  type OwnSubmission,
  type Player,
  type PrivateState,
  type PublicQuestion,
  type RoomMeta,
} from "../types";
import Hangman, { StrokeDots } from "../components/Hangman";
import Countdown from "../components/Countdown";
import PreCountdown from "../components/PreCountdown";
import SoundToggle from "../components/SoundToggle";
import Podium from "../components/Podium";
import HangmanVerdict from "../components/HangmanVerdict";
import { StatusBadges } from "../components/Leaderboard";
import QuestionDisplay, { Prompt } from "../components/QuestionDisplay";
import { MultipleChoiceInput, TrueFalseInput } from "../components/answers/ChoiceInput";
import FillBlankInput from "../components/answers/FillBlankInput";
import MatchingInput from "../components/answers/MatchingInput";
import OrderingInput from "../components/answers/OrderingInput";
import WordGuessInput from "../components/answers/WordGuessInput";

export default function Play() {
  const { pin = "" } = useParams();
  const { user, ready } = useAuthUser();
  const [authError, setAuthError] = useState<string | null>(null);

  // Người chơi dùng Anonymous Auth – uid được giữ khi tải lại trang.
  useEffect(() => {
    if (ready && !user) signInAnonymously(auth).catch((e) => setAuthError(errorMessage(e)));
  }, [ready, user]);

  if (!/^\d{6}$/.test(pin)) return <Message>Mã PIN không hợp lệ. <Link to="/" className="underline">Nhập lại</Link></Message>;
  if (authError) return <Message>Không đăng nhập được: {authError}</Message>;
  if (!user) return <Message>Đang kết nối…</Message>;
  return <PlayRoom pin={pin} uid={user.uid} />;
}

function PlayRoom({ pin, uid }: { pin: string; uid: string }) {
  const meta = useDbValue<RoomMeta>(`rooms/${pin}/meta`);
  const me = useDbValue<Player>(`rooms/${pin}/players/${uid}`);
  const joined = !!me.value;
  const playersDb = useDbValue<Record<string, Player>>(joined ? `rooms/${pin}/players` : null);
  const questionDb = useDbValue<PublicQuestion>(joined ? `rooms/${pin}/currentQuestion` : null);
  const priv = useDbValue<PrivateState>(joined ? `rooms/${pin}/private/${uid}` : null);
  // Bài nộp của chính mình cho lượt đang mở (để biết đã nộp chưa, các chữ đã đoán).
  const openSlot = meta.value?.slot ?? null;
  const mine = useDbValue<OwnSubmission>(joined && openSlot ? `rooms/${pin}/submissions/${openSlot}/${uid}` : null);
  const offset = useServerOffset();
  usePresence(pin, uid, joined);

  const m = meta.value;
  const player = me.value;
  const status = m?.status;
  const slot = m ? slotKey(m) : null;
  const question: PublicQuestion | null = questionDb.value && questionDb.value.slot === slot ? questionDb.value : null;
  const ranked = useMemo(() => rankPlayers(playersDb.value), [playersDb.value]);
  const rank = ranked.findIndex((p) => p.uid === uid) + 1;
  const theme = themeForRound(m?.round ?? 1, m?.roundInfo);

  // Rung màn hình + âm thanh khi bị cộng nét (đoán chữ sai). Lúc công bố đáp án, màn tình trạng tự lo phần này.
  const liveStrokes = status === "REVEAL" ? undefined : player?.strokes;
  const shaking = useShakeOnIncrease(liveStrokes);
  const prevStrokes = usePrevious(liveStrokes);
  useEffect(() => {
    if (liveStrokes !== undefined && prevStrokes !== undefined && liveStrokes > prevStrokes) {
      (liveStrokes >= MAX_STROKES ? sfx.hanged : sfx.stroke)();
    }
  }, [liveStrokes, prevStrokes]);

  // Âm thanh khi công bố kết quả câu.
  const result = priv.value?.lastResult;
  const prevStatus = usePrevious(status);
  useEffect(() => {
    if (status !== "REVEAL" || prevStatus === "REVEAL" || !result || result.slot !== slot || !result.participated) return;
    if (result.bailout) return; // kết quả cứu trợ đã phát âm thanh lúc nộp
    if (result.correct) sfx.correct();
    else if (!result.strokesAdded) sfx.wrong();
  }, [status, prevStatus, result, slot]);

  if (meta.loading || me.loading) return <Message>Đang vào phòng {pin}…</Message>;
  if (!m) return <Message>Không tìm thấy phòng {pin}. <Link to="/" className="underline">Nhập mã khác</Link></Message>;
  if (!player) {
    if (m.status === "FINISHED") return <Message>Trò chơi trong phòng này đã kết thúc.</Message>;
    return <JoinForm pin={pin} uid={uid} />;
  }

  return (
    <div className={`flex min-h-screen flex-col ${shaking ? "shake flash-red" : ""}`}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gold-600/20 bg-coal-950/90 px-3 py-2 backdrop-blur">
        <Hangman
          strokes={player.strokes}
          theme={theme}
          rescued={isRescued(player)}
          eliminated={player.status === "ELIMINATED"}
          className="h-14 w-12 shrink-0 text-gold-300"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">
            {player.nickname}
            <StatusBadges player={player} />
          </p>
          <StrokeDots strokes={player.strokes} />
        </div>
        <div className="text-right">
          <p className="font-display text-xl leading-none text-gold-400">{player.score.toLocaleString("vi-VN")}</p>
          <p className="text-xs text-gold-300/70">
            {rank > 0 ? `Hạng ${rank}/${ranked.length}` : ""} {player.streak > 1 ? `· 🔥${player.streak}` : ""}
          </p>
        </div>
        <SoundToggle className="px-2 py-1 text-base" />
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-5">
        {status === "LOBBY" && (
          <Center>
            <Hangman strokes={0} className="h-48 w-40 text-gold-300" />
            <p className="title-display text-3xl">Bạn đã vào phòng!</p>
            <p className="text-lg text-gold-300/80">Nhìn lên màn hình lớn và chờ host bắt đầu…</p>
            <p className="text-sm text-gold-300/60">Bạn có 7 nét: {STROKE_NAMES.join(" · ")}. Đủ 7 nét là bị treo!</p>
          </Center>
        )}

        {status === "ROUND_INTRO" && (
          <Center>
            <Hangman strokes={MAX_STROKES} theme={theme} className="h-40 w-36 text-gold-300" key={m.round} />
            <p className="round-zoom title-display text-5xl">Vòng {m.round}</p>
            <p className="text-2xl font-extrabold text-gold-300">{m.roundInfo?.title}</p>
            {m.roundInfo?.subtitle && <p className="text-gold-300/70">{m.roundInfo.subtitle}</p>}
          </Center>
        )}

        {(status === "QUESTION" || status === "BAILOUT") &&
          (question ? (
            <QuestionPhase
              key={question.slot}
              pin={pin}
              uid={uid}
              meta={m}
              question={question}
              player={player}
              priv={priv.value}
              mine={mine.value}
              offset={offset}
              bailout={status === "BAILOUT"}
            />
          ) : (
            <Center>Đang tải câu hỏi…</Center>
          ))}

        {status === "REVEAL" &&
          question &&
          (question.bailoutRound ? (
            <BailoutRevealPhase question={question} result={result?.slot === question.slot ? result : undefined} player={player} theme={theme} />
          ) : (
            <RevealPhase
              key={question.slot}
              question={question}
              result={result?.slot === question.slot ? result : undefined}
              player={player}
              theme={theme}
            />
          ))}

        {status === "FINISHED" && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="title-display text-3xl">Kết thúc!</p>
              <p className="mt-2 text-xl font-bold">
                Bạn xếp hạng <span className="font-display text-gold-400">{rank}</span>/{ranked.length} với{" "}
                <span className="font-display text-gold-400">{player.score.toLocaleString("vi-VN")}</span> điểm
              </p>
            </div>
            <Podium players={ranked} highlightUid={uid} />
          </div>
        )}
      </main>
    </div>
  );
}

function QuestionPhase({
  pin,
  uid,
  mine,
  meta,
  question,
  player,
  priv,
  offset,
  bailout,
}: {
  pin: string;
  meta: RoomMeta;
  question: PublicQuestion;
  player: Player;
  uid: string;
  mine: OwnSubmission | null;
  priv: PrivateState | null;
  offset: number;
  /** Câu "Gói cứu trợ của Nhà nước". */
  bailout: boolean;
}) {
  const [submittedLocal, setSubmittedLocal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  // Đếm ngược "Chuẩn bị!" trước khi được chọn đáp án (questionStartedAt nằm ở tương lai).
  const untilStart = useCountdown(meta.questionStartedAt, offset);
  // Host đang đặt mốc giờ (vài trăm ms sau khi hiện câu) – coi như vẫn đang đếm ngược.
  const startPending = !meta.questionStartedAt;

  const eligible = bailout ? player.status === "HANGED" && !player.bailoutUsed : player.status === "ALIVE";
  const submitted = submittedLocal || mine?.at != null;
  const bailoutResult = bailout && priv?.lastResult?.slot === question.slot ? priv.lastResult : null;

  const submit = async (payload: Record<string, unknown>) => {
    setSending(true);
    setError(null);
    try {
      await submitAnswer(db, pin, question.slot, uid, payload);
      setSubmittedLocal(true);
      sfx.submit();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const disabled = sending || expired;
  const inputProps = { question, disabled, onSubmit: submit };
  const onExpire = () => {
    setExpired(true);
    if (eligible && !submitted && question.type !== "WORD_GUESS") sfx.timeUp();
  };

  const label = bailout ? (
    <span className="font-extrabold text-emerald-400">🏛️ {BAILOUT_TITLE}</span>
  ) : (
    <>
      Câu {question.index + 1}/{question.total} · {TYPE_LABELS[question.type]}
    </>
  );

  // Gói cứu trợ: người còn sống chỉ đứng xem.
  if (bailout && player.status === "ALIVE" && !bailoutResult) {
    return (
      <Center>
        <p className="text-6xl">🏛️</p>
        <p className="title-display text-2xl">Đang tiến hành cứu trợ…</p>
        <p className="text-gold-300/80">{BAILOUT_TITLE} đang cứu những người bị treo. Bạn an toàn – hãy chờ vòng tiếp theo.</p>
        <p className="text-sm italic text-gold-300/60">“{BAILOUT_SUBTITLE}”</p>
      </Center>
    );
  }
  // Gói cứu trợ: đã nộp → hiện kết quả ngay.
  if (bailout && (bailoutResult || submitted)) {
    return bailoutResult ? <BailoutResultCard result={bailoutResult} /> : <Center>Đang xử lý gói cứu trợ…</Center>;
  }

  if (startPending || untilStart > 0) {
    return (
      <div className="flex flex-1 flex-col gap-5">
        {bailout && <BailoutBanner />}
        <p className="text-sm font-bold text-gold-300/80">{label}</p>
        <Prompt question={question} size="phone" />
        <div className="flex flex-1 items-center justify-center">
          <PreCountdown startsAt={meta.questionStartedAt ?? null} offset={offset} />
        </div>
        {!eligible && <p className="text-center text-sm text-gold-300/70">{spectatorText(player, bailout)}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {bailout && <BailoutBanner />}
      <div className="flex items-center gap-3">
        <Countdown deadline={meta.deadline ?? 0} limitSec={question.timeLimitSec} offset={offset} onExpire={onExpire} tick={eligible && !submitted} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gold-300/80">{label}</p>
          {bailout && eligible && <p className="text-sm font-bold text-emerald-400">Trả lời đúng để được cứu – về 6 nét!</p>}
        </div>
      </div>
      <Prompt question={question} size="phone" />

      {!eligible ? (
        <div className="card space-y-3 p-5 text-center">
          <p className="text-xl font-extrabold text-blood-400">{player.status === "ELIMINATED" ? "Bạn đã bị loại ⚰️" : "Bạn đã bị treo ☠️"}</p>
          <p className="text-gold-300/80">{spectatorText(player, bailout)}</p>
          <QuestionDisplay question={question} size="phone" />
        </div>
      ) : question.type === "WORD_GUESS" ? (
        <WordGuessInput pin={pin} uid={uid} question={question} state={priv?.wordGuess ?? null} sent={mine?.guesses} disabled={expired} />
      ) : submitted ? (
        <Center>
          <p className="pop-in text-5xl">📨</p>
          <p className="title-display text-2xl">Đã nộp bài!</p>
          <p className="text-gold-300/80">Chờ host công bố đáp án…</p>
        </Center>
      ) : expired ? (
        <Center>
          <p className="title-display text-2xl text-blood-400">Hết giờ!</p>
        </Center>
      ) : (
        <>
          {question.type === "MULTIPLE_CHOICE" && <MultipleChoiceInput {...inputProps} />}
          {question.type === "TRUE_FALSE" && <TrueFalseInput {...inputProps} />}
          {question.type === "MATCHING" && <MatchingInput {...inputProps} />}
          {question.type === "ORDERING" && <OrderingInput {...inputProps} />}
          {question.type === "FILL_BLANK" && <FillBlankInput {...inputProps} />}
        </>
      )}
      {error && <p className="rounded-lg bg-blood-800/60 p-3 text-center font-bold text-blood-400">{error}</p>}
    </div>
  );
}

/** Sau khi hiện đáp án bao lâu thì bật màn tình trạng treo cổ. */
const VERDICT_DELAY_MS = 2500;

function RevealPhase({
  question,
  result,
  player,
  theme,
}: {
  question: PublicQuestion;
  result?: LastResult;
  player: Player;
  theme: HangmanTheme;
}) {
  // Xem đáp án trước, rồi mới hiện hình treo cổ hiện tại của mình.
  const [verdictOpen, setVerdictOpen] = useState(false);
  const canShowVerdict = !!result?.participated;
  useEffect(() => {
    if (!canShowVerdict) return;
    const t = window.setTimeout(() => setVerdictOpen(true), VERDICT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [canShowVerdict]);

  let headline: { text: string; className: string; icon: string };
  if (!result || !result.participated) {
    headline = { text: "Bạn đang là khán giả", className: "text-gold-300", icon: "👀" };
  } else if (result.correct) {
    headline = { text: "Chính xác!", className: "text-emerald-400", icon: "✅" };
  } else if (!result.answered) {
    headline = { text: "Hết giờ – không trả lời!", className: "text-blood-400", icon: "⏰" };
  } else {
    headline = { text: "Sai rồi!", className: "text-blood-400", icon: "❌" };
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="pop-in card space-y-2 p-5 text-center">
        <p className="text-5xl">{headline.icon}</p>
        <p className={`title-display text-3xl ${headline.className}`}>{headline.text}</p>
        {result?.participated && (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 whitespace-nowrap text-xl font-extrabold">
            {result.points > 0 && <span className="text-gold-400">+{result.points.toLocaleString("vi-VN")} điểm</span>}
            {result.strokesAdded > 0 && <span className="text-blood-400">+{result.strokesAdded} nét</span>}
            {result.streak > 1 && result.correct && <span className="text-orange-400">🔥 chuỗi {result.streak}</span>}
            {question.type === "WORD_GUESS" && (result.wrongLetters ?? 0) > 0 && (
              <span className="text-sm text-gold-300/80">
                {result.wrongLetters} chữ sai{result.correct ? ` (−${(result.wrongLetters ?? 0) * 10}% điểm)` : ""}
              </span>
            )}
          </div>
        )}
        {result?.hangedNow && (
          <p className="text-xl font-extrabold text-blood-400">Đủ 7 nét – bạn đã bị TREO! Chờ “{BAILOUT_TITLE}” cuối vòng nhé.</p>
        )}
        {result?.eliminatedNow && (
          <p className="text-xl font-extrabold text-blood-400">Đã được cứu một lần mà lại đủ 7 nét – bạn bị LOẠI chung cuộc ⚰️</p>
        )}
        {player.status === "ALIVE" && player.strokes > 0 && (
          <p className="text-sm text-gold-300/70">
            Còn {MAX_STROKES - player.strokes} nét nữa là {player.bailoutUsed ? "bị LOẠI (đã dùng cứu trợ)" : "bị treo"}.
          </p>
        )}
      </div>
      {canShowVerdict && !verdictOpen && (
        <button type="button" className="btn-ghost text-base" onClick={() => setVerdictOpen(true)}>
          Xem tình trạng treo cổ của tôi
        </button>
      )}
      <Prompt question={question} reveal={question.reveal} size="phone" />
      <QuestionDisplay question={question} reveal={question.reveal} size="phone" />
      {question.reveal?.explanation && (
        <p className="card p-4 text-sm leading-relaxed">
          <span className="font-extrabold text-gold-400">💡 </span>
          {question.reveal.explanation}
        </p>
      )}
      {verdictOpen && result && <HangmanVerdict player={player} result={result} theme={theme} onClose={() => setVerdictOpen(false)} />}
    </div>
  );
}

function spectatorText(player: Player, bailout: boolean): string {
  if (player.status === "ELIMINATED") return "Bạn đã được cứu một lần nhưng lại đủ 7 nét – bị loại chung cuộc. Hãy cổ vũ mọi người nhé!";
  if (bailout) return "Bạn đã dùng gói cứu trợ rồi – mỗi người chỉ được cứu một lần.";
  if (player.bailoutUsed) return "Bạn đã dùng gói cứu trợ và vẫn bị treo – giờ bạn là khán giả.";
  return `Bạn đang là khán giả. Cuối vòng sẽ có “${BAILOUT_TITLE}” – trả lời đúng để về 6 nét và quay lại!`;
}

function BailoutBanner() {
  return (
    <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/40 p-3 text-center">
      <p className="font-display text-lg uppercase text-emerald-300">🏛️ {BAILOUT_TITLE}</p>
      <p className="text-xs italic text-gold-300/70">“{BAILOUT_SUBTITLE}”</p>
    </div>
  );
}

/** Kết quả gói cứu trợ của chính mình (hiện ngay khi nộp và khi host công bố). */
function BailoutResultCard({ result, theme, sound = true }: { result: LastResult; theme?: HangmanTheme; sound?: boolean }) {
  useEffect(() => {
    if (sound) (result.rescued ? sfx.correct : sfx.wrong)();
  }, [result.rescued, sound]);
  return (
    <div className="pop-in card flex flex-col items-center gap-3 p-5 text-center">
      {result.rescued ? (
        <>
          <Hangman strokes={MAX_STROKES - 1} theme={theme} rescued animateRescue className="h-48 w-40 text-gold-300" ghost={false} />
          <p className="title-display text-3xl text-emerald-400">Bạn đã được cứu! 🩹</p>
          <p className="text-gold-300/90">Dây đã được cắt – bạn quay lại chơi với 6 nét. Không cộng điểm, không còn hệ số nhân.</p>
          <p className="text-sm font-bold text-blood-400">Cẩn thận: thêm 1 nét nữa là bị LOẠI chung cuộc!</p>
        </>
      ) : (
        <>
          <Hangman strokes={MAX_STROKES} theme={theme} className="h-48 w-40 text-gold-300" ghost={false} />
          <p className="title-display text-3xl text-blood-400">Cứu trợ thất bại</p>
          <p className="text-gold-300/90">{result.answered ? "Câu trả lời chưa đúng" : "Bạn không kịp trả lời"} – bạn vẫn bị treo và đã dùng hết lượt cứu trợ.</p>
        </>
      )}
      <p className="text-xs italic text-gold-300/60">“{BAILOUT_SUBTITLE}”</p>
    </div>
  );
}

function BailoutRevealPhase({
  question,
  result,
  player,
  theme,
}: {
  question: PublicQuestion;
  result?: LastResult;
  player: Player;
  theme: HangmanTheme;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <BailoutBanner />
      {result?.participated ? (
        <BailoutResultCard result={result} theme={theme} sound={false} />
      ) : (
        <div className="card p-5 text-center">
          <p className="title-display text-2xl">{player.status === "ALIVE" ? "Gói cứu trợ đã kết thúc" : "Bạn đang là khán giả"}</p>
          <p className="mt-1 text-gold-300/80">Chuẩn bị sang vòng tiếp theo…</p>
        </div>
      )}
      <Prompt question={question} reveal={question.reveal} size="phone" />
      <QuestionDisplay question={question} reveal={question.reveal} size="phone" />
      {question.reveal?.explanation && (
        <p className="card p-4 text-sm leading-relaxed">
          <span className="font-extrabold text-gold-400">💡 </span>
          {question.reveal.explanation}
        </p>
      )}
    </div>
  );
}

function JoinForm({ pin, uid }: { pin: string; uid: string }) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinRoom(db, pin, uid, nickname);
      sfx.join();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4">
      <Hangman strokes={0} className="h-40 w-36 text-gold-300" />
      <p className="text-lg font-bold text-gold-300/80">
        Phòng <span className="font-display text-gold-400">{pin}</span>
      </p>
      <form onSubmit={submit} className="card w-full space-y-4 p-5">
        <label className="block">
          <span className="mb-2 block text-center text-lg font-bold text-gold-300">Chọn nickname</span>
          <input
            className="input text-center text-2xl"
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            placeholder="VD: Nhà tư bản nhỏ"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        {error && <p className="rounded-lg bg-blood-800/60 p-3 text-center font-semibold text-blood-400">{error}</p>}
        <button className="btn-gold w-full text-xl" disabled={busy || !nickname.trim()}>
          {busy ? "Đang vào…" : "Vào chơi!"}
        </button>
      </form>
      <Link to="/" className="text-sm text-gold-300/70 hover:underline">
        ← Nhập mã PIN khác
      </Link>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">{children}</div>;
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-8 text-center text-xl font-bold text-gold-300">{children}</div>;
}
