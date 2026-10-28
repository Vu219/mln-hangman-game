/**
 * Xử lý chuỗi tiếng Việt: bỏ dấu để so khớp, nhưng vẫn giữ nguyên chuỗi gốc để hiển thị.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Bỏ toàn bộ dấu tiếng Việt: "Ứ" -> "U", "Đ" -> "D", "ơ" -> "o". Giữ nguyên hoa/thường. */
export function removeVietnameseTones(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

/** Chuẩn hoá câu trả lời tự do: bỏ dấu, chữ thường, gộp khoảng trắng, bỏ dấu câu ở hai đầu. */
export function normalizeAnswer(input: string): string {
  return removeVietnameseTones(input)
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?"'“”‘’()[\]-]+|[\s.,;:!?"'“”‘’()[\]-]+$/g, "");
}

/** So khớp hai câu trả lời theo luật: bỏ dấu, không phân biệt hoa thường. */
export function answersMatch(given: string, expected: string): boolean {
  return normalizeAnswer(given) === normalizeAnswer(expected);
}

/** Chữ cái gốc (A–Z) của một ký tự, hoặc null nếu không phải chữ cái. "Ừ" -> "U", "đ" -> "D". */
export function baseLetter(ch: string): string | null {
  const base = removeVietnameseTones(ch).toUpperCase();
  return /^[A-Z]$/.test(base) ? base : null;
}

/** Chuẩn hoá chữ cái người chơi đoán. Trả về null nếu không phải đúng 1 chữ cái. */
export function normalizeGuessLetter(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if ([...trimmed].length !== 1) return null;
  return baseLetter(trimmed);
}

/** Khoá so trùng nickname: bỏ dấu, chữ thường, gộp khoảng trắng. "Tư Bản" trùng "tu  ban". */
export function nicknameKey(nickname: string): string {
  return normalizeAnswer(nickname).replace(/[.#$/[\]]/g, "_");
}
