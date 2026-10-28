// Thả người chơi giả lập vào một phòng đang chạy trên emulator để thử giao diện host.
// Dùng: npm run bots -- <PIN> [số_bot=4]
// Bot ghi thẳng vào Realtime Database giống trình duyệt người chơi (không còn Cloud Functions);
// trang host đang mở sẽ chấm điểm.
import { readFileSync } from "node:fs";
import { signInAnonymously } from "firebase/auth";
import { onValue, ref, runTransaction, serverTimestamp, set } from "firebase/database";
import { createClient, sleep } from "./emulator-client.mjs";

const [pin, countArg] = process.argv.slice(2);
if (!/^\d{6}$/.test(pin ?? "")) {
  console.error("Cách dùng: npm run bots -- <PIN 6 số> [số bot]");
  process.exit(1);
}
const count = Math.min(30, Number(countArg ?? 4));
const NAMES = ["Rockefeller", "Carnegie", "Morgan", "Zuckerberg", "Bezos", "Musk", "Gates", "Vanderbilt", "Ford", "Page", "Brin", "Cook"];
// Bot "biết" đáp án của bộ câu mặc định và trả lời đúng ~60%.
const qset = JSON.parse(readFileSync(new URL("../frontend/src/data/questions.json", import.meta.url), "utf8"));
const bank = Object.fromEntries([...qset.questions, ...qset.rounds.flatMap((r) => r.bailoutQuestions ?? [])].map((q) => [q.id, q]));
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
const rand = (n) => Math.floor(Math.random() * n);
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toUpperCase();

function payload(q, smart) {
  const key = bank[q.id];
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return { choice: smart && key ? key.answerIndex : rand(4) };
    case "TRUE_FALSE":
      return { value: smart && key ? key.answer : Math.random() < 0.5 };
    case "MATCHING":
      return { pairs: smart && key ? key.pairs.map((p) => p.right) : shuffle(q.right) };
    case "ORDERING":
      return { order: smart && key ? key.items : shuffle(q.items) };
    case "FILL_BLANK":
      return { answers: smart && key ? key.blanks.map((b) => b[0]) : Array(q.blankCount).fill("không biết") };
  }
}

async function runBot(i) {
  const c = createClient(`bot-${i}`);
  await signInAnonymously(c.auth);
  const uid = c.auth.currentUser.uid;
  const nickname = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ""}`;
  const key = nickname.toLowerCase();
  const claim = await runTransaction(ref(c.db, `rooms/${pin}/nicknames/${key}`), (cur) => (cur === null || cur === uid ? uid : undefined));
  if (!claim.committed) throw new Error(`Nickname ${nickname} đã có người dùng`);
  await set(ref(c.db, `rooms/${pin}/players/${uid}`), {
    nickname,
    nicknameKey: key,
    score: 0,
    strokes: 0,
    status: "ALIVE",
    streak: 0,
    bailoutUsed: false,
    correctCount: 0,
    totalAnswerMs: 0,
    online: true,
    joinedAt: serverTimestamp(),
  });
  console.log(`🤖 ${nickname} đã vào phòng ${pin}`);
  const skill = 0.4 + Math.random() * 0.45;
  let me = null;
  let meta = null;
  let board = null;
  const handled = new Set();
  onValue(ref(c.db, `rooms/${pin}/players/${uid}`), (s) => (me = s.val()));
  onValue(ref(c.db, `rooms/${pin}/private/${uid}/wordGuess`), (s) => (board = s.val()));
  onValue(ref(c.db, `rooms/${pin}/meta`), async (s) => {
    meta = s.val();
    // Chỉ hành động khi host đã đặt giờ cho lượt đang mở.
    if (!meta?.slot || !meta.questionStartedAt || handled.has(meta.slot)) return;
    if (meta.status !== "QUESTION" && meta.status !== "BAILOUT") return;
    const slot = meta.slot;
    handled.add(slot);
    const bailout = meta.status === "BAILOUT";
    await sleep(meta.questionStartedAt - Date.now() + 800 + Math.random() * (bailout ? 3000 : 6000));
    const q = await new Promise((resolve) => onValue(ref(c.db, `rooms/${pin}/currentQuestion`), (snap) => resolve(snap.val()), { onlyOnce: true }));
    if (!q || q.slot !== slot || meta?.slot !== slot || !me) return;
    // Câu thường: người còn sống. Gói cứu trợ: người bị treo chưa dùng cứu trợ.
    const eligible = bailout ? me.status === "HANGED" && !me.bailoutUsed : me.status === "ALIVE";
    if (!eligible || Math.random() < 0.08) return; // thỉnh thoảng "quên" trả lời
    const smart = Math.random() < skill;
    try {
      if (q.type === "WORD_GUESS") {
        const word = bank[q.id]?.word ?? "";
        const right = [...new Set([...strip(word)].filter((ch) => /[A-Z]/.test(ch)))];
        const letters = shuffle("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")).sort((a, b) => (smart ? right.includes(b) - right.includes(a) : 0));
        for (const letter of letters) {
          if (meta?.slot !== slot || meta?.status !== "QUESTION") break;
          if (board?.index === q.index && (board.solved || board.failed)) break;
          await set(ref(c.db, `rooms/${pin}/submissions/${slot}/${uid}/guesses/${letter}`), serverTimestamp());
          await sleep(700 + Math.random() * 1200);
        }
      } else {
        await set(ref(c.db, `rooms/${pin}/submissions/${slot}/${uid}`), { payload: payload(q, smart), at: serverTimestamp() });
      }
    } catch (e) {
      console.log(`  ${nickname}: ${e.message}`);
    }
  });
}

await Promise.all(Array.from({ length: count }, (_, i) => runBot(i)));
console.log(`${count} bot đang chơi. Nhấn Ctrl+C để dừng.`);
