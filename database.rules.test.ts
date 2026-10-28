/**
 * Kiểm thử Security Rules (kiến trúc host-authoritative, không dùng Cloud Functions).
 * Chạy: npm run test:rules  (tự bật database emulator qua `firebase emulators:exec`)
 * Nếu emulator đang chạy sẵn: npx vitest run --config vitest.rules.config.ts
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, onDisconnect, ref, remove, runTransaction, serverTimestamp, set, update } from "firebase/database";

// Namespace riêng: test gọi clearDatabase() nên không được đụng vào dữ liệu của emulator đang chơi thử.
const PROJECT_ID = "demo-giatreoco-rules";
const PIN = "123456";
let env: RulesTestEnvironment;

const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000").split(":");

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules: readFileSync("database.rules.json", "utf8"), host, port: Number(port) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

const player = (over: Record<string, unknown> = {}) => ({
  nickname: "X",
  nicknameKey: "x",
  score: 0,
  strokes: 0,
  status: "ALIVE",
  streak: 0,
  bailoutUsed: false,
  correctCount: 0,
  totalAnswerMs: 0,
  online: true,
  joinedAt: 1,
  ...over,
});

/** Dữ liệu mồi (ghi bằng quyền admin, bỏ qua rules). `meta` ghi đè trạng thái câu hỏi. */
async function seed(meta: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await env.clearDatabase();
  const now = Date.now();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), "/"), {
      admins: { hostA: true },
      rooms: {
        [PIN]: {
          meta: {
            hostUid: "hostA",
            status: "QUESTION",
            currentIndex: 3,
            totalQuestions: 10,
            round: 1,
            slot: "3",
            questionStartedAt: now - 5000,
            deadline: now + 60000,
            createdAt: 1,
            ...meta,
          },
          currentQuestion: { slot: "3", type: "MULTIPLE_CHOICE", prompt: "?", options: ["a", "b", "c", "d"] },
          players: {
            alice: player({ nickname: "Alice", nicknameKey: "alice" }),
            bob: player({ nickname: "Bob", nicknameKey: "bob" }),
            hanged: player({ nickname: "Hanged", nicknameKey: "hanged", strokes: 7, status: "HANGED" }),
            used: player({ nickname: "Used", nicknameKey: "used", strokes: 7, status: "HANGED", bailoutUsed: true }),
          },
          nicknames: { alice: "alice", bob: "bob", hanged: "hanged", used: "used" },
          private: { alice: { lastResult: { correct: true } }, bob: { lastResult: { correct: false } } },
          stats: { "3": { answered: 0 } },
          ...extra,
        },
      },
      roomSecrets: {
        [PIN]: { hostUid: "hostA", createdAt: 1, questions: [{ id: "q1", answerIndex: 0 }], rounds: [] },
      },
    });
  });
}

const as = (uid: string) => env.authenticatedContext(uid).database();
const anon = () => env.unauthenticatedContext().database();
const room = (path: string) => `rooms/${PIN}/${path}`;
const submit = (uid: string, slot = "3", body: Record<string, unknown> = { payload: { choice: 1 }, at: serverTimestamp() }) =>
  set(ref(as(uid), room(`submissions/${slot}/${uid}`)), body);

describe("quyền host qua /admins", () => {
  beforeEach(() => seed());
  it("chỉ đọc được cờ admin của chính mình, không ai tự cấp quyền", async () => {
    await assertSucceeds(get(ref(as("hostA"), "admins/hostA")));
    await assertFails(get(ref(as("alice"), "admins/hostA")));
    await assertFails(set(ref(as("alice"), "admins/alice"), true));
  });
  it("admin tạo được phòng mới (meta + roomSecrets), người thường thì không", async () => {
    const meta = { hostUid: "hostA", status: "LOBBY", currentIndex: -1, totalQuestions: 1, createdAt: 1 };
    await assertSucceeds(set(ref(as("hostA"), "rooms/555555/meta"), meta));
    await assertSucceeds(set(ref(as("hostA"), "roomSecrets/555555"), { hostUid: "hostA", questions: [{ id: "a" }] }));
    await assertFails(set(ref(as("alice"), "rooms/666666/meta"), { ...meta, hostUid: "alice" }));
    await assertFails(set(ref(as("alice"), "roomSecrets/666666"), { hostUid: "alice", questions: [] }));
  });
  it("tạo PIN bằng transaction không ghi đè được phòng của người khác", async () => {
    const meta = { hostUid: "hostB", status: "LOBBY", currentIndex: -1, totalQuestions: 1, createdAt: 1 };
    await assertFails(set(ref(as("hostB"), room("meta")), meta));
    const tx = await runTransaction(ref(as("hostA"), "rooms/777777/meta"), (cur) =>
      cur === null ? { hostUid: "hostA", status: "LOBBY", currentIndex: -1, totalQuestions: 1, createdAt: 1 } : undefined,
    );
    if (!tx.committed) throw new Error("transaction phải tạo được phòng mới");
  });
});

describe("roomSecrets – chỉ host của phòng", () => {
  beforeEach(() => seed());
  it("người chơi không đọc được câu hỏi kèm đáp án", async () => {
    await assertFails(get(ref(as("alice"), `roomSecrets/${PIN}`)));
    await assertFails(get(ref(as("alice"), `roomSecrets/${PIN}/questions`)));
    await assertFails(get(ref(anon(), `roomSecrets/${PIN}`)));
  });
  it("người chơi không ghi được, host thì đọc/ghi được", async () => {
    await assertFails(set(ref(as("alice"), `roomSecrets/${PIN}/answers/3/alice`), { correct: true }));
    await assertSucceeds(get(ref(as("hostA"), `roomSecrets/${PIN}`)));
    await assertSucceeds(set(ref(as("hostA"), `roomSecrets/${PIN}/answers/3/alice`), { correct: true }));
    await assertFails(set(ref(as("hostA"), `roomSecrets/${PIN}/hostUid`), "alice"));
  });
});

describe("dữ liệu công khai & quyền ghi của host", () => {
  beforeEach(() => seed());
  it("người đã đăng nhập đọc được meta, câu hỏi, người chơi, thống kê; chưa đăng nhập thì không", async () => {
    for (const p of ["meta", "currentQuestion", "players", "stats", "nicknames"]) {
      await assertSucceeds(get(ref(as("bob"), room(p))));
      await assertFails(get(ref(anon(), room(p))));
    }
  });
  it("người chơi không ghi được meta, currentQuestion, stats", async () => {
    await assertFails(set(ref(as("alice"), room("meta/status")), "FINISHED"));
    await assertFails(set(ref(as("alice"), room("meta/deadline")), Date.now() + 999999));
    await assertFails(set(ref(as("alice"), room("currentQuestion/prompt")), "hack"));
    await assertFails(set(ref(as("alice"), room("stats/3/answered")), 99));
  });
  it("host ghi được meta, currentQuestion, stats, điểm/nét/trạng thái người chơi, private", async () => {
    await assertSucceeds(update(ref(as("hostA"), room("meta")), { status: "REVEAL" }));
    await assertSucceeds(set(ref(as("hostA"), room("currentQuestion/reveal")), { explanation: "x" }));
    await assertSucceeds(set(ref(as("hostA"), room("stats/3")), { answered: 2 }));
    await assertSucceeds(
      update(ref(as("hostA")), {
        [room("players/alice/score")]: 1200,
        [room("players/alice/strokes")]: 1,
        [room("players/hanged/status")]: "ALIVE",
        [room("players/hanged/bailoutUsed")]: true,
        [room("private/alice/lastResult")]: { correct: true },
      }),
    );
  });
  it("host không đổi được hostUid sang người khác", async () => {
    await assertFails(set(ref(as("hostA"), room("meta/hostUid")), "alice"));
  });
});

describe("players – người chơi tự vào phòng nhưng không tự sửa điểm", () => {
  beforeEach(() => seed());
  it("tự tạo players/{uid} hợp lệ sau khi giữ chỗ nickname", async () => {
    await assertSucceeds(set(ref(as("carol"), room("nicknames/carol")), "carol"));
    await assertSucceeds(set(ref(as("carol"), room("players/carol")), player({ nickname: "Carol", nicknameKey: "carol", joinedAt: serverTimestamp() })));
  });
  it("không giữ chỗ được nickname đã có người dùng", async () => {
    await assertFails(set(ref(as("carol"), room("nicknames/alice")), "carol"));
  });
  it("không tạo được người chơi với điểm/nét/trạng thái gian lận hoặc nickname chưa giữ chỗ", async () => {
    await set(ref(as("carol"), room("nicknames/carol")), "carol");
    const ok = (over: Record<string, unknown>) => player({ nickname: "Carol", nicknameKey: "carol", joinedAt: serverTimestamp(), ...over });
    await assertFails(set(ref(as("carol"), room("players/carol")), ok({ score: 99999 })));
    await assertFails(set(ref(as("carol"), room("players/carol")), ok({ strokes: -3 })));
    await assertFails(set(ref(as("carol"), room("players/carol")), ok({ bailoutUsed: true })));
    await assertFails(set(ref(as("carol"), room("players/carol")), ok({ joinedAt: 1 })));
    await assertFails(set(ref(as("carol"), room("players/carol")), ok({ nicknameKey: "alice" })));
    await assertFails(set(ref(as("carol"), room("players/carol")), ok({ isAdmin: true })));
    await assertFails(set(ref(as("carol"), room("players/dave")), ok({})));
  });
  it("người chơi tự sửa điểm, nét, trạng thái, bailoutUsed đều bị từ chối", async () => {
    await assertFails(set(ref(as("alice"), room("players/alice/score")), 999999));
    await assertFails(set(ref(as("alice"), room("players/alice/strokes")), 0));
    await assertFails(set(ref(as("hanged"), room("players/hanged/status")), "ALIVE"));
    await assertFails(set(ref(as("used"), room("players/used/bailoutUsed")), false));
    await assertFails(set(ref(as("alice"), room("players/alice/streak")), 50));
    await assertFails(set(ref(as("alice"), room("players/alice")), player({ nickname: "Alice", nicknameKey: "alice", joinedAt: serverTimestamp() })));
    await assertFails(update(ref(as("alice"), room("players/alice")), { online: true, score: 10 }));
  });
  it("chỉ ghi được online (boolean) của chính mình, kể cả qua onDisconnect", async () => {
    await assertSucceeds(set(ref(as("alice"), room("players/alice/online")), false));
    await assertSucceeds(onDisconnect(ref(as("alice"), room("players/alice/online"))).set(false));
    await assertFails(set(ref(as("alice"), room("players/alice/online")), "yes"));
    await assertFails(set(ref(as("alice"), room("players/bob/online")), false));
  });
});

describe("submissions – nộp bài", () => {
  it("người còn sống nộp đúng lượt, đúng giờ, một lần", async () => {
    await seed();
    await assertSucceeds(submit("alice"));
    await assertFails(submit("alice")); // nộp 2 lần
  });
  it("không giả mạo thời điểm nộp, không nộp hộ người khác, không nộp sai lượt", async () => {
    await seed();
    await assertFails(submit("alice", "3", { payload: { choice: 1 }, at: Date.now() - 4000 }));
    await assertFails(set(ref(as("alice"), room("submissions/3/bob")), { payload: { choice: 1 }, at: serverTimestamp() }));
    await assertFails(submit("alice", "2"));
  });
  it("nộp sau deadline bị từ chối", async () => {
    await seed({ questionStartedAt: Date.now() - 30000, deadline: Date.now() - 1000 });
    await assertFails(submit("alice"));
  });
  it("nộp trong lúc đếm ngược Chuẩn bị bị từ chối", async () => {
    await seed({ questionStartedAt: Date.now() + 4000, deadline: Date.now() + 30000 });
    await assertFails(submit("alice"));
  });
  it("nộp khi đã hiện đáp án bị từ chối", async () => {
    await seed({ status: "REVEAL" });
    await assertFails(submit("alice"));
  });
  it("người bị treo không nộp được câu thường", async () => {
    await seed();
    await assertFails(submit("hanged"));
  });
  it("chỉ chủ bài nộp và host đọc được bài nộp", async () => {
    await seed();
    await submit("alice");
    await assertSucceeds(get(ref(as("alice"), room("submissions/3/alice"))));
    await assertFails(get(ref(as("bob"), room("submissions/3/alice"))));
    await assertFails(get(ref(as("bob"), room("submissions/3"))));
    await assertSucceeds(get(ref(as("hostA"), room("submissions/3"))));
  });
  it("chỉ host đánh dấu đã chấm", async () => {
    await seed();
    await submit("alice");
    await assertFails(set(ref(as("alice"), room("submissions/3/alice/graded")), true));
    await assertSucceeds(set(ref(as("hostA"), room("submissions/3/alice/graded")), true));
  });
});

describe("Gói cứu trợ – chỉ người HANGED chưa dùng cứu trợ được nộp", () => {
  beforeEach(() =>
    seed(
      { status: "BAILOUT", slot: "bailout-1", bailoutRound: 1 },
      { currentQuestion: { slot: "bailout-1", type: "TRUE_FALSE", bailoutRound: 1, prompt: "?" } },
    ),
  );
  it("người ALIVE nộp câu cứu trợ bị từ chối", async () => {
    await assertFails(submit("alice", "bailout-1"));
  });
  it("người đã dùng cứu trợ không nộp lại được", async () => {
    await assertFails(submit("used", "bailout-1"));
  });
  it("người bị treo chưa dùng cứu trợ nộp được một lần", async () => {
    await assertSucceeds(submit("hanged", "bailout-1"));
    await assertFails(submit("hanged", "bailout-1"));
  });
});

describe("Đoán chữ – mỗi chữ một lần", () => {
  beforeEach(() => seed({}, { currentQuestion: { slot: "3", type: "WORD_GUESS", prompt: "?" } }));
  const guess = (uid: string, letter: string, value: unknown = serverTimestamp()) =>
    set(ref(as(uid), room(`submissions/3/${uid}/guesses/${letter}`)), value);
  it("đoán được từng chữ, không đoán lại cùng chữ", async () => {
    await assertSucceeds(guess("alice", "A"));
    await assertSucceeds(guess("alice", "B"));
    await assertFails(guess("alice", "A"));
  });
  it("chữ không hợp lệ, giả mạo thời gian, người bị treo đều bị từ chối", async () => {
    await assertFails(guess("alice", "ab"));
    await assertFails(guess("alice", "a"));
    await assertFails(guess("alice", "C", Date.now()));
    await assertFails(guess("hanged", "A"));
  });
  it("không nộp payload cho câu đoán chữ", async () => {
    await assertFails(submit("alice"));
  });
});

describe("private/{uid}", () => {
  beforeEach(() => seed());
  it("chủ sở hữu và host đọc được, người khác thì không", async () => {
    await assertSucceeds(get(ref(as("alice"), room("private/alice"))));
    await assertSucceeds(get(ref(as("hostA"), room("private/alice"))));
    await assertFails(get(ref(as("bob"), room("private/alice"))));
    await assertFails(get(ref(as("alice"), room("private"))));
  });
  it("người chơi không tự ghi kết quả", async () => {
    await assertFails(set(ref(as("alice"), room("private/alice/lastResult")), { correct: true, points: 9999 }));
  });
});

describe("xoá phòng", () => {
  beforeEach(() => seed());
  it("chỉ host xoá được phòng và roomSecrets", async () => {
    await assertFails(remove(ref(as("alice"), `rooms/${PIN}`)));
    await assertFails(remove(ref(as("alice"), `roomSecrets/${PIN}`)));
    await assertSucceeds(remove(ref(as("hostA"), `roomSecrets/${PIN}`)));
    await assertSucceeds(remove(ref(as("hostA"), `rooms/${PIN}`)));
  });
});
