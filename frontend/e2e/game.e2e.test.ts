/**
 * Chạy thử trọn một ván trên Firebase Emulator (chỉ auth + database, không Cloud Functions):
 * 1 host (dùng đúng bộ máy chấm điểm của trang host) + 3 người chơi (dùng đúng thao tác của trang người chơi).
 * Chạy: npm run e2e:ci (tự bật emulator) hoặc npm run e2e khi emulator đang chạy.
 */
import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { signInAnonymously, signInWithEmailAndPassword } from "firebase/auth";
import { get, ref, set, type Database } from "firebase/database";
import bank from "../src/data/questions.json";
import { removeVietnameseTones } from "../src/game";
import {
  createRoom,
  deleteRoom,
  gradeSlot,
  loadSecrets,
  nextQuestion,
  revealAnswer,
  startGame,
  startGrader,
  type HostMeta,
  type HostSecrets,
} from "../src/host/engine";
import { guessLetter, joinRoom, submitAnswer } from "../src/lib/playerActions";
import { createClient, ensureHostUser, HOST_EMAIL, HOST_PASSWORD, sleep, waitFor } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Q = any;

let passed = 0;
function ok(cond: unknown, msg: string) {
  assert.ok(cond, msg);
  passed++;
  console.log(`  ✓ ${msg}`);
}
async function expectReject(promise: Promise<unknown>, pattern: RegExp, msg: string) {
  try {
    await promise;
  } catch (e) {
    const text = (e as Error).message;
    assert.match(text, pattern, `${msg} – lỗi: ${text}`);
    passed++;
    console.log(`  ✓ ${msg} → "${text.split("\n")[0]}"`);
    return;
  }
  assert.fail(`${msg} – lẽ ra phải bị từ chối`);
}

const tones = (s: string) => removeVietnameseTones(s).toUpperCase();
const lettersOf = (word: string) => [...new Set([...tones(word)].filter((c) => /[A-Z]/.test(c)))];
const lettersNotIn = (word: string) => "QWZJFXKY".split("").filter((c) => !lettersOf(word).includes(c));
const bailoutBank: Record<string, Q> = Object.fromEntries(
  (bank.rounds as Q[]).flatMap((r) => (r.bailoutQuestions ?? []).map((q: Q) => [q.id, { ...q, round: r.round }])),
);

function correctPayload(q: Q) {
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return { choice: q.answerIndex };
    case "TRUE_FALSE":
      return { value: q.answer };
    case "MATCHING":
      return { pairs: q.pairs.map((p: Q) => p.right) };
    case "ORDERING":
      return { order: q.items };
    case "FILL_BLANK":
      return { answers: q.blanks.map((b: string[]) => tones(b[0])) }; // thử luôn so khớp bỏ dấu
  }
  throw new Error(q.type);
}
function wrongPayload(q: Q) {
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return { choice: (q.answerIndex + 1) % 4 };
    case "TRUE_FALSE":
      return { value: !q.answer };
    case "MATCHING":
      return { pairs: [q.pairs[1].right, q.pairs[0].right, ...q.pairs.slice(2).map((p: Q) => p.right)] };
    case "ORDERING":
      return { order: [...q.items].reverse() };
    case "FILL_BLANK":
      return { answers: q.blanks.map(() => "sai bét") };
  }
  throw new Error(q.type);
}

it("chơi trọn một ván: host chấm điểm trong trình duyệt, gói cứu trợ, host tải lại trang giữa câu", async () => {
  console.log("\n=== E2E trên emulator (auth + database, không Cloud Functions) ===\n");

  // ---------- Host ----------
  const hostUid = await ensureHostUser();
  let host = createClient("host");
  await signInWithEmailAndPassword(host.auth, HOST_EMAIL, HOST_PASSWORD);
  ok(host.auth.currentUser?.uid === hostUid, "Host đăng nhập, có /admins/{uid} = true");

  const intruder = createClient("intruder");
  await signInAnonymously(intruder.auth);
  await expectReject(createRoom(intruder.db, intruder.auth.currentUser!.uid, bank), /chưa có quyền host/, "Người không có trong /admins không tạo được phòng");
  await expectReject(
    set(ref(intruder.db, "rooms/999999/meta"), { hostUid: intruder.auth.currentUser!.uid, status: "LOBBY", currentIndex: -1, totalQuestions: 1 }),
    /permission/i,
    "Rules chặn tạo phòng trực tiếp khi không phải admin",
  );
  const bad = { questions: [{ id: "x", round: 1, type: "MULTIPLE_CHOICE", prompt: "?", timeLimitSec: 20, options: ["a"], answerIndex: 0 }] };
  await expectReject(createRoom(host.db, hostUid, bad), /cần đúng 4 phần tử/, "Bộ câu sai schema bị từ chối, lỗi tiếng Việt");
  await expectReject(
    createRoom(host.db, hostUid, { questions: [{ id: "r", round: 1, type: "TRUE_FALSE", rescue: true, prompt: "?", timeLimitSec: 20, answer: true }] }),
    /bailoutQuestions/,
    "File cũ dùng rescue bị từ chối, gợi ý bailoutQuestions",
  );

  const { pin, total } = await createRoom(host.db, hostUid, bank);
  ok(/^\d{6}$/.test(pin) && total === bank.questions.length, `Tạo phòng ${pin} với bộ câu mặc định (${total} câu)`);
  let secrets: HostSecrets = await loadSecrets(host.db, pin);

  // ---------- Người chơi ----------
  const names = ["An", "Bình", "Chi"];
  const players: { nickname: string; uid: string; db: Database }[] = [];
  for (const nickname of names) {
    const c = createClient(`p-${nickname}`);
    await signInAnonymously(c.auth);
    const uid = c.auth.currentUser!.uid;
    const r = await joinRoom(c.db, pin, uid, nickname);
    players.push({ nickname, uid, db: c.db });
    ok(r.nickname === nickname && !r.rejoined, `${nickname} vào phòng`);
  }
  const [an, binh, chi] = players;
  const dup = createClient("dup");
  await signInAnonymously(dup.auth);
  await expectReject(joinRoom(dup.db, pin, dup.auth.currentUser!.uid, "  BÌNH "), /đã có người dùng/, "Nickname trùng (không phân biệt dấu/hoa thường) bị từ chối");
  await expectReject(joinRoom(dup.db, "000000", dup.auth.currentUser!.uid, "Zed"), /Không tìm thấy phòng/, "PIN không tồn tại báo lỗi");

  // ---------- Gian lận qua client thật ----------
  await expectReject(get(ref(an.db, `roomSecrets/${pin}`)), /permission/i, "Người chơi không đọc được roomSecrets");
  await expectReject(get(ref(an.db, `rooms/${pin}/private/${binh.uid}`)), /permission/i, "Không đọc được private của người khác");
  await expectReject(set(ref(an.db, `rooms/${pin}/players/${an.uid}/score`), 99999), /permission/i, "Không tự sửa điểm");
  await expectReject(set(ref(an.db, `rooms/${pin}/meta/status`), "FINISHED"), /permission/i, "Người chơi không điều khiển được trò chơi");
  await set(ref(an.db, `rooms/${pin}/players/${an.uid}/online`), true);
  ok(true, "Tự ghi presence online được");

  const meta = async (): Promise<HostMeta> => (await get(ref(host.db, `rooms/${pin}/meta`))).val();
  const player = async (p: { uid: string }) => (await get(ref(host.db, `rooms/${pin}/players/${p.uid}`))).val();
  const lastResult = async (p: { uid: string; db: Database }) => (await get(ref(p.db, `rooms/${pin}/private/${p.uid}/lastResult`))).val();

  // Trang host: chạy bộ chấm điểm cho lượt đang mở.
  let stopGrader: (() => void) | null = null;
  const runGrader = (m: HostMeta) => {
    stopGrader?.();
    stopGrader = startGrader(host.db, pin, secrets, m, (e) => console.error("Lỗi chấm điểm:", e));
  };

  await startGame(host.db, pin, secrets);
  ok((await meta()).status === "ROUND_INTRO", "Bắt đầu → màn giới thiệu vòng 1");

  const bailoutRounds: number[] = [];
  const roundIntros: number[] = [];
  let deadlineTested = false;
  let reloadTested = false;
  let wordGuessChecked = false;
  let earlyBailoutTested = false;
  let sawHanged = false;
  let sawEliminated = false;

  async function handleQuestion(m: HostMeta) {
    const i = m.currentIndex;
    const slot = String(i);
    const q: Q = bank.questions[i];
    const pub = (await get(ref(an.db, `rooms/${pin}/currentQuestion`))).val();
    const leaked = ["answerIndex", "answer", "pairs", "blanks", "word", "explanation"].filter((k) => k in pub);
    assert.deepEqual(leaked, [], `Câu ${i} lộ đáp án: ${leaked}`);
    assert.equal(pub.slot, slot);
    assert.equal(m.deadline! - m.questionStartedAt!, q.timeLimitSec * 1000, "deadline = questionStartedAt + thời gian (server timestamp)");
    console.log(`  [${i + 1}/${bank.questions.length}] ${q.type}: ${q.prompt.slice(0, 60)}…`);

    // Ca host tải lại trang giữa câu hỏi: tắt bộ chấm điểm trước khi người chơi nộp.
    const simulateReload = !reloadTested && q.type === "MULTIPLE_CHOICE" && i >= 2;
    if (simulateReload) {
      stopGrader?.();
      stopGrader = null;
    } else {
      runGrader(m);
    }

    if (i === 0) {
      await expectReject(submitAnswer(an.db, pin, slot, an.uid, correctPayload(q)), /Không nộp được/, "Không trả lời được khi đang đếm ngược chuẩn bị");
    }
    await sleep(m.questionStartedAt! - Date.now() + 150);

    const states = Object.fromEntries(await Promise.all(players.map(async (p) => [p.nickname, await player(p)])));
    const canPlay = (p: { nickname: string }) => states[p.nickname].status === "ALIVE";

    if (q.type === "WORD_GUESS") {
      // An đoán sai 1 chữ rồi giải được (trừ 10%); Bình đoán toàn chữ sai đến hết lượt; Chi không chơi.
      if (canPlay(binh)) {
        for (const l of lettersNotIn(q.word).slice(0, 5)) await guessLetter(binh.db, pin, slot, binh.uid, l);
        const board = await waitFor(async () => {
          const b = (await get(ref(binh.db, `rooms/${pin}/private/${binh.uid}/wordGuess`))).val();
          return b?.failed ? b : null;
        }, "host khoá bảng của Bình");
        ok(board.wrong.length === 5, "Bình hết 5 lượt đoán sai thì host khoá bảng");
        if (!wordGuessChecked) {
          ok((await player(binh)).strokes === states[binh.nickname].strokes, "Đoán chữ sai không bị cộng nét ngay lúc đoán");
          await guessLetter(binh.db, pin, slot, binh.uid, lettersOf(q.word)[0]);
          await sleep(600);
          const after = (await get(ref(binh.db, `rooms/${pin}/private/${binh.uid}/wordGuess`))).val();
          ok(after.failed && !after.board.some((c: string) => c !== "_" && c !== " "), "Hết lượt sai thì đoán thêm cũng không mở được chữ");
          await expectReject(guessLetter(binh.db, pin, slot, binh.uid, lettersOf(q.word)[0]), /Không đoán được/, "Không gửi lại cùng một chữ");
        }
      }
      if (canPlay(an)) {
        await guessLetter(an.db, pin, slot, an.uid, lettersNotIn(q.word)[0]);
        await sleep(300); // để chữ sai có thời điểm sớm hơn các chữ đúng
        for (const l of lettersOf(q.word)) await guessLetter(an.db, pin, slot, an.uid, l);
        const board = await waitFor(async () => {
          const b = (await get(ref(an.db, `rooms/${pin}/private/${an.uid}/wordGuess`))).val();
          return b?.solved ? b : null;
        }, "host mở xong bảng của An");
        assert.equal(board.board.join(""), q.word.toUpperCase(), "Bảng hiển thị có dấu");
      }
    } else {
      for (const p of players) {
        if (!canPlay(p)) {
          await expectReject(submitAnswer(p.db, pin, slot, p.uid, correctPayload(q)), /Không nộp được/, `${p.nickname} (${states[p.nickname].status}) không nộp được câu thường`);
          continue;
        }
        if (p === chi) continue; // Chi luôn bỏ lỡ câu thường
        await submitAnswer(p.db, pin, slot, p.uid, p === an ? correctPayload(q) : wrongPayload(q));
      }
      if (i === 0) {
        await expectReject(submitAnswer(an.db, pin, slot, an.uid, correctPayload(q)), /Không nộp được/, "Mỗi người chỉ nộp 1 lần mỗi câu");
      }
      if (simulateReload) {
        await sleep(800);
        ok(((await get(ref(host.db, `rooms/${pin}/stats/${slot}/answered`))).val() ?? 0) === 0, "Host đóng tab: bài nộp nằm chờ, chưa được chấm");
        // "Tải lại trang": client mới, đăng nhập lại cùng tài khoản host, nạp lại bộ câu từ roomSecrets, chấm tiếp.
        host = createClient("host-reloaded");
        await signInWithEmailAndPassword(host.auth, HOST_EMAIL, HOST_PASSWORD);
        secrets = await loadSecrets(host.db, pin);
        const restored = await meta();
        runGrader(restored);
        const expected = players.filter((p) => canPlay(p) && p !== chi).length;
        await waitFor(async () => ((await get(ref(host.db, `rooms/${pin}/stats/${slot}/answered`))).val() ?? 0) === expected, "host chấm lại sau khi tải trang");
        ok(true, `Host tải lại trang giữa câu: khôi phục và chấm ${expected} bài đang chờ`);
        const graded = (await get(ref(host.db, `rooms/${pin}/submissions/${slot}`))).val();
        ok(Object.values(graded as Record<string, Q>).every((s) => s.graded === true), "Bài đã chấm được đánh dấu graded");
        const answersBefore = (await get(ref(host.db, `roomSecrets/${pin}/answers/${slot}`))).val();
        await gradeSlot(host.db, pin, secrets, restored);
        const answersAfter = (await get(ref(host.db, `roomSecrets/${pin}/answers/${slot}`))).val();
        ok(JSON.stringify(answersBefore) === JSON.stringify(answersAfter), "Chấm lại lần nữa không thay đổi kết quả (không chấm trùng)");
        reloadTested = true;
      }
      if (!deadlineTested && q.type === "TRUE_FALSE" && canPlay(chi)) {
        const waitMs = m.deadline! + 400 - Date.now();
        console.log(`    … chờ ${(waitMs / 1000).toFixed(1)}s để kiểm tra hết giờ`);
        await sleep(waitMs);
        await expectReject(submitAnswer(chi.db, pin, slot, chi.uid, correctPayload(q)), /Không nộp được/, "Nộp sau deadline (theo giờ server) bị rules từ chối");
        deadlineTested = true;
      }
    }

    const statsLive = (await get(ref(host.db, `rooms/${pin}/stats/${slot}`))).val();
    await revealAnswer(host.db, pin, secrets);
    stopGrader?.();
    await expectReject(revealAnswer(host.db, pin, secrets), /không có câu hỏi nào đang chạy/, "Không hiện đáp án 2 lần");
    const after = Object.fromEntries(await Promise.all(players.map(async (p) => [p.nickname, await player(p)])));
    const results = Object.fromEntries(await Promise.all(players.map(async (p) => [p.nickname, await lastResult(p)])));
    const reveal = (await get(ref(an.db, `rooms/${pin}/currentQuestion/reveal`))).val();
    assert.ok(reveal && typeof reveal.explanation === "string", "Công khai đáp án + giải thích");
    const statsAfter = (await get(ref(host.db, `rooms/${pin}/stats/${slot}`))).val();
    assert.ok(statsAfter.eligible === statsLive.eligible || q.type === "WORD_GUESS", "Thống kê số người được chơi");

    if (q.type === "WORD_GUESS" && !wordGuessChecked) {
      ok(results[an.nickname].correct && results[an.nickname].wrongLetters === 1, `An giải được từ sau 1 chữ sai: +${results[an.nickname].points} điểm (đã trừ 10%)`);
      ok(after[binh.nickname].strokes - states[binh.nickname].strokes === 1, "Đoán chữ hết lượt sai: chỉ +1 nét khi hiện đáp án");
      ok(after[chi.nickname].strokes - states[chi.nickname].strokes === 1, "Đoán chữ không trả lời: +1 nét");
      wordGuessChecked = true;
    }
    for (const p of players) {
      const b = states[p.nickname];
      const a = after[p.nickname];
      const r = results[p.nickname];
      if (b.status === "ALIVE") {
        assert.equal(r.slot, slot);
        if (p === an) {
          assert.ok(r.correct && r.points > 0 && a.score === b.score + r.points, `An đúng, +${r.points} điểm`);
          assert.equal(a.streak, b.streak + 1);
          assert.ok(a.totalAnswerMs > b.totalAnswerMs, "Cộng dồn tổng thời gian trả lời (at - questionStartedAt)");
        } else {
          assert.equal(a.strokes, b.strokes + 1, `${p.nickname} sai/không trả lời: đúng +1 nét`);
          assert.equal(a.streak, 0);
          if (a.strokes >= 7) {
            // Đã từng được cứu mà lại đủ 7 nét → bị loại chung cuộc.
            assert.equal(a.status, b.bailoutUsed ? "ELIMINATED" : "HANGED", `${p.nickname} đủ 7 nét`);
            if (a.status === "ELIMINATED") sawEliminated = true;
            else sawHanged = true;
          }
        }
      } else {
        assert.deepEqual([a.score, a.strokes, a.status], [b.score, b.strokes, b.status], `${p.nickname} (${b.status}) là khán giả`);
      }
    }
    logScores(after);
    await expectReject(submitAnswer(an.db, pin, slot, an.uid, { choice: 0 }), /Không nộp được/, "Không nộp được sau khi hiện đáp án");
  }

  async function handleBailout(m: HostMeta) {
    const round = m.bailoutRound!;
    const slot = `bailout-${round}`;
    bailoutRounds.push(round);
    runGrader(m);
    const pub = (await get(ref(chi.db, `rooms/${pin}/currentQuestion`))).val();
    console.log(`\n  🏛️ GÓI CỨU TRỢ sau vòng ${round}: ${pub.type} – ${pub.prompt.slice(0, 55)}…`);
    assert.equal(pub.slot, slot);
    assert.equal(pub.bailoutRound, round);
    const leaked = ["answerIndex", "answer", "pairs", "blanks", "explanation"].filter((k) => k in pub);
    assert.deepEqual(leaked, [], "Câu cứu trợ không lộ đáp án");
    const key = bailoutBank[pub.id];
    assert.ok(key && key.round === round, "Câu cứu trợ lấy ngẫu nhiên từ bailoutQuestions của đúng vòng");
    assert.equal(m.deadline! - m.questionStartedAt!, (key.timeLimitSec ?? 15) * 1000);
    const metaPublic = (await get(ref(chi.db, `rooms/${pin}/meta/roundInfo`))).val();
    assert.ok(!("bailoutQuestions" in (metaPublic ?? {})), "meta.roundInfo không chứa câu cứu trợ");

    const states = Object.fromEntries(await Promise.all(players.map(async (p) => [p.nickname, await player(p)])));
    const expected = players.filter((p) => states[p.nickname].status === "HANGED" && !states[p.nickname].bailoutUsed);
    const statsStart = (await get(ref(host.db, `rooms/${pin}/stats/${slot}`))).val();
    assert.deepEqual(Object.keys(statsStart.eligibleUids).sort(), expected.map((p) => p.uid).sort(), "Danh sách người đủ điều kiện cứu trợ");
    ok(expected.length > 0, `Vòng ${round}: ${expected.map((p) => p.nickname).join(", ")} đủ điều kiện cứu trợ`);

    if (!earlyBailoutTested) {
      await expectReject(submitAnswer(expected[0].db, pin, slot, expected[0].uid, correctPayload(key)), /Không nộp được/, "Không nộp câu cứu trợ khi đang đếm ngược");
      earlyBailoutTested = true;
    }
    await sleep(m.questionStartedAt! - Date.now() + 150);

    for (const p of players) {
      const st = states[p.nickname];
      if (!expected.includes(p)) {
        await expectReject(
          submitAnswer(p.db, pin, slot, p.uid, correctPayload(key)),
          /Không nộp được/,
          `${p.nickname} (${st.status}${st.bailoutUsed ? ", đã dùng cứu trợ" : ""}) không nộp được câu cứu trợ`,
        );
        continue;
      }
      const good = p === binh; // Bình trả lời đúng, Chi trả lời sai
      await submitAnswer(p.db, pin, slot, p.uid, good ? correctPayload(key) : wrongPayload(key));
      // Host áp dụng ngay khi chấm để màn hình đếm realtime.
      const now = await waitFor(async () => {
        const v = await player(p);
        return v.bailoutUsed ? v : null;
      }, `host chấm câu cứu trợ của ${p.nickname}`);
      if (good) {
        ok(now.status === "ALIVE" && now.strokes === 6 && now.streak === 0 && now.score === st.score, `${p.nickname} trả lời đúng → được cứu ngay: 6 nét, ALIVE, không cộng điểm`);
      } else {
        ok(now.status === "HANGED", `${p.nickname} trả lời sai → vẫn HANGED, đã dùng cứu trợ`);
      }
      await expectReject(submitAnswer(p.db, pin, slot, p.uid, correctPayload(key)), /Không nộp được/, `${p.nickname} không nộp câu cứu trợ lần hai`);
    }
    const rescuedLive = await waitFor(async () => {
      const v = (await get(ref(host.db, `rooms/${pin}/stats/${slot}/rescued`))).val();
      return v === expected.filter((p) => p === binh).length ? String(v) : null;
    }, "đếm realtime số người được cứu");
    ok(true, `Đếm realtime: ${rescuedLive}/${expected.length} đã được cứu`);

    await revealAnswer(host.db, pin, secrets);
    stopGrader?.();
    const after = Object.fromEntries(await Promise.all(players.map(async (p) => [p.nickname, await player(p)])));
    for (const p of players) {
      const b = states[p.nickname];
      const a = after[p.nickname];
      if (b.status === "ALIVE") {
        assert.deepEqual([a.score, a.strokes, a.status], [b.score, b.strokes, b.status], `${p.nickname} còn sống không bị cộng nét ở BAILOUT`);
      }
      if (expected.includes(p)) {
        const r = await lastResult(p);
        assert.ok(r.bailout && r.slot === slot && r.participated, `${p.nickname} nhận kết quả cứu trợ`);
      }
    }
    const stats = (await get(ref(host.db, `rooms/${pin}/stats/${slot}`))).val();
    ok(String(stats.rescued) === rescuedLive && stats.eligible === expected.length, `Thống kê cứu trợ: ${stats.rescued}/${stats.eligible} được cứu`);
    logScores(after);
  }

  function logScores(after: Record<string, Q>) {
    const icon = (s: Q) => (s.status === "HANGED" ? "☠" : s.status === "ELIMINATED" ? "⚰" : "") + (s.bailoutUsed && s.status !== "HANGED" ? "🩹" : "");
    console.log(`    → ${players.map((p) => `${p.nickname}: ${after[p.nickname].score}đ/${after[p.nickname].strokes}nét${icon(after[p.nickname])}`).join(" | ")}`);
  }

  for (let guard = 0; ; guard++) {
    assert.ok(guard < 200, "Vòng lặp trò chơi quá dài");
    const m = await meta();
    if (m.status === "FINISHED") break;
    if (m.status === "ROUND_INTRO") {
      roundIntros.push(m.round);
      console.log(`\n— Vòng ${m.round}: ${m.roundInfo?.title}`);
    } else if (m.status === "QUESTION") {
      await handleQuestion(m);
    } else if (m.status === "BAILOUT") {
      await handleBailout(m);
    } else {
      assert.fail(`Trạng thái không mong đợi: ${m.status}`);
    }
    await nextQuestion(host.db, pin, secrets);
  }

  ok(reloadTested, "Đã thử host tải lại trang giữa câu hỏi");
  ok(sawHanged, "Có người chơi đủ 7 nét và bị treo");
  ok(sawEliminated, "Người đã được cứu mà đủ 7 nét lần nữa → ELIMINATED");
  ok(JSON.stringify(bailoutRounds) === "[1]", `Gói cứu trợ chỉ mở sau vòng ${bailoutRounds.join(", ")}: vòng 2, 3 không ai đủ điều kiện, không có sau vòng 4`);
  ok(JSON.stringify(roundIntros) === "[1,2,3,4]", "Đủ 4 màn giới thiệu vòng");
  ok(deadlineTested, "Đã kiểm tra hết giờ theo thời gian server");
  const [anEnd, binhEnd, chiEnd] = await Promise.all(players.map(player));
  ok(binhEnd.status === "ELIMINATED" && binhEnd.bailoutUsed, "Bình: được cứu rồi bị loại chung cuộc");
  ok(chiEnd.status === "HANGED" && chiEnd.bailoutUsed, "Chi: cứu trợ thất bại, vẫn bị treo");
  ok(anEnd.status === "ALIVE" && !anEnd.bailoutUsed && anEnd.strokes === 0, `An: chưa từng cần cứu trợ, ${anEnd.score} điểm`);

  // Vào lại (tải lại trang): cùng uid giữ nguyên điểm/nét
  const rejoin = await joinRoom(an.db, pin, an.uid, "An");
  ok(rejoin.rejoined && (await player(an)).score === anEnd.score, "Vào lại giữ nguyên điểm và số nét");
  const late = createClient("late");
  await signInAnonymously(late.auth);
  await expectReject(joinRoom(late.db, pin, late.auth.currentUser!.uid, "Muộn"), /đã kết thúc/, "Không vào được phòng đã kết thúc");

  // ---------- Xóa phòng (thay cho hàm dọn dẹp định kỳ) ----------
  await expectReject(deleteRoom(an.db, pin), /permission/i, "Người chơi không xoá được phòng");
  await deleteRoom(host.db, pin);
  ok(!(await get(ref(host.db, `rooms/${pin}/meta`))).exists(), "Host bấm Xóa phòng: rooms/{pin} đã bị xoá");
  await expectReject(get(ref(host.db, `roomSecrets/${pin}`)).then((s) => (s.exists() ? s : Promise.reject(new Error("permission_denied (đã xoá)")))), /permission/i, "roomSecrets/{pin} cũng đã bị xoá");

  console.log(`\n✅ E2E thành công: ${passed} kiểm tra đạt. PIN ${pin}\n`);
  expect(passed).toBeGreaterThan(100);
});
