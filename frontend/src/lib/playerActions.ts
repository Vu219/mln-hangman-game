/**
 * Thao tác của người chơi – ghi thẳng vào Realtime Database (không qua Cloud Functions).
 * Security rules kiểm tra: đúng lượt, còn giờ (theo đồng hồ server), mỗi người nộp 1 lần, đủ điều kiện (ALIVE / cứu trợ).
 */
import { get, ref, remove, runTransaction, serverTimestamp, set, type Database } from "firebase/database";
import { nicknameKey } from "../game";

export const NICKNAME_MAX = 20;
export const MAX_PLAYERS = 100;

export class PlayerError extends Error {}

function isPermissionDenied(e: unknown): boolean {
  const s = String((e as { code?: string; message?: string })?.code ?? "") + String((e as Error)?.message ?? "");
  return /permission/i.test(s);
}

/** Vào phòng: giữ chỗ nickname (không dấu, không phân biệt hoa thường) bằng transaction rồi tự tạo players/{uid}. */
export async function joinRoom(db: Database, pin: string, uid: string, rawNickname: string): Promise<{ nickname: string; rejoined: boolean }> {
  if (!/^\d{6}$/.test(pin)) throw new PlayerError("Mã PIN phải gồm đúng 6 chữ số.");
  const nickname = rawNickname.replace(/\s+/g, " ").trim();
  if (!nickname) throw new PlayerError("Hãy nhập nickname.");
  if ([...nickname].length > NICKNAME_MAX) throw new PlayerError(`Nickname tối đa ${NICKNAME_MAX} ký tự.`);
  const key = nicknameKey(nickname);
  if (!key) throw new PlayerError("Nickname phải có chữ hoặc số.");

  const meta = (await get(ref(db, `rooms/${pin}/meta`))).val() as { status?: string } | null;
  if (!meta) throw new PlayerError(`Không tìm thấy phòng ${pin}. Kiểm tra lại mã PIN.`);
  const existing = (await get(ref(db, `rooms/${pin}/players/${uid}`))).val() as { nickname: string } | null;
  if (existing) {
    // Tải lại trang / vào lại: giữ nguyên điểm và số nét.
    await set(ref(db, `rooms/${pin}/players/${uid}/online`), true);
    return { nickname: existing.nickname, rejoined: true };
  }
  if (meta.status === "FINISHED") throw new PlayerError("Trò chơi trong phòng này đã kết thúc.");
  const count = Object.keys(((await get(ref(db, `rooms/${pin}/players`))).val() ?? {}) as object).length;
  if (count >= MAX_PLAYERS) throw new PlayerError(`Phòng đã đủ ${MAX_PLAYERS} người chơi.`);

  const nickRef = ref(db, `rooms/${pin}/nicknames/${key}`);
  const claim = await runTransaction(nickRef, (current: string | null) => (current === null || current === uid ? uid : undefined), {
    applyLocally: false,
  });
  if (!claim.committed) throw new PlayerError(`Nickname "${nickname}" đã có người dùng trong phòng, hãy chọn tên khác.`);

  try {
    await set(ref(db, `rooms/${pin}/players/${uid}`), {
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
  } catch (e) {
    await remove(nickRef).catch(() => {});
    if (isPermissionDenied(e)) throw new PlayerError("Không vào được phòng (phòng đã kết thúc hoặc dữ liệu không hợp lệ).");
    throw e;
  }
  return { nickname, rejoined: false };
}

/** Nộp bài một lần cho lượt `slot` ("5" hoặc "bailout-2"). Thời điểm nộp là server timestamp. */
export async function submitAnswer(db: Database, pin: string, slot: string, uid: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await set(ref(db, `rooms/${pin}/submissions/${slot}/${uid}`), { payload, at: serverTimestamp() });
  } catch (e) {
    if (isPermissionDenied(e)) throw new PlayerError("Không nộp được – đã hết giờ, chưa tới lúc trả lời, hoặc bạn đã nộp bài rồi.");
    throw e;
  }
}

/** Câu đoán chữ: gửi một chữ cái (mỗi chữ một lần). Host sẽ mở bảng và chấm. */
export async function guessLetter(db: Database, pin: string, slot: string, uid: string, letter: string): Promise<void> {
  if (!/^[A-Z]$/.test(letter)) throw new PlayerError("Hãy chọn một chữ cái A–Z.");
  try {
    await set(ref(db, `rooms/${pin}/submissions/${slot}/${uid}/guesses/${letter}`), serverTimestamp());
  } catch (e) {
    if (isPermissionDenied(e)) throw new PlayerError("Không đoán được – đã hết giờ hoặc chữ này đã đoán rồi.");
    throw e;
  }
}
