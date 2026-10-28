import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { onDisconnect, onValue, ref, set } from "firebase/database";
import { auth, db } from "../firebase";

export function useAuthUser() {
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({ user: auth.currentUser, ready: false });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, ready: true })), []);
  return state;
}

/** Lắng nghe realtime một đường dẫn trong RTDB. path = null để tạm ngừng. */
export function useDbValue<T>(path: string | null): { value: T | null; loading: boolean; error: Error | null } {
  const [state, setState] = useState<{ value: T | null; loading: boolean; error: Error | null; path: string | null }>({
    value: null,
    loading: !!path,
    error: null,
    path,
  });
  useEffect(() => {
    if (!path) {
      setState({ value: null, loading: false, error: null, path });
      return;
    }
    setState((s) => ({ ...s, loading: s.path !== path || s.loading, path }));
    return onValue(
      ref(db, path),
      (snap) => setState({ value: snap.val() as T | null, loading: false, error: null, path }),
      (error) => setState({ value: null, loading: false, error, path }),
    );
  }, [path]);
  return { value: state.value, loading: state.loading, error: state.error };
}

/** Chênh lệch giữa đồng hồ máy và đồng hồ server (ms). */
export function useServerOffset(): number {
  const { value } = useDbValue<number>(".info/serverTimeOffset");
  return value ?? 0;
}

/** Thời gian còn lại (ms) tới deadline theo giờ server, cập nhật ~10 lần/giây. */
export function useCountdown(deadline: number | null | undefined, offset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, deadline - (now + offset));
}

/** Presence: online = true khi kết nối, tự đặt false khi mất kết nối (onDisconnect). */
export function usePresence(pin: string | undefined, uid: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!pin || !uid || !enabled) return;
    const onlineRef = ref(db, `rooms/${pin}/players/${uid}/online`);
    const unsub = onValue(ref(db, ".info/connected"), (snap) => {
      if (snap.val() !== true) return;
      onDisconnect(onlineRef)
        .set(false)
        .then(() => set(onlineRef, true))
        .catch(() => {});
    });
    return () => {
      unsub();
      set(onlineRef, false).catch(() => {});
    };
  }, [pin, uid, enabled]);
}

/** Giá trị của lần render trước. */
export function usePrevious<T>(value: T): T | undefined {
  const r = useRef<T>();
  useEffect(() => {
    r.current = value;
  }, [value]);
  return r.current;
}

/** Rung màn hình (class CSS "shake") + rung điện thoại khi số nét tăng. */
export function useShakeOnIncrease(value: number | undefined): boolean {
  const prev = usePrevious(value);
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (value === undefined || prev === undefined || value <= prev) return;
    setShaking(true);
    navigator.vibrate?.([120, 60, 180]);
    const t = window.setTimeout(() => setShaking(false), 650);
    return () => window.clearTimeout(t);
  }, [value, prev]);
  return shaking;
}
