import { FirebaseError } from "firebase/app";

const GENERIC: Record<string, string> = {
  PERMISSION_DENIED: "Không có quyền thực hiện thao tác này.",
  "auth/invalid-credential": "Sai email hoặc mật khẩu.",
  "auth/wrong-password": "Sai email hoặc mật khẩu.",
  "auth/user-not-found": "Sai email hoặc mật khẩu.",
  "auth/invalid-email": "Email không hợp lệ.",
  "auth/too-many-requests": "Thử quá nhiều lần, hãy đợi một lát.",
  "auth/network-request-failed": "Lỗi mạng, kiểm tra kết nối.",
  "auth/operation-not-allowed": "Phương thức đăng nhập này chưa được bật trong Firebase Console.",
};

/** Thông báo lỗi tiếng Việt (lỗi của game đã là tiếng Việt; lỗi Firebase thì dịch các mã thường gặp). */
export function errorMessage(e: unknown): string {
  if (e instanceof FirebaseError) return GENERIC[e.code] ?? e.message;
  const code = (e as { code?: string })?.code;
  if (code && GENERIC[code]) return GENERIC[code];
  if (e instanceof Error && /permission_denied/i.test(e.message)) return GENERIC.PERMISSION_DENIED;
  return e instanceof Error ? e.message : String(e);
}
