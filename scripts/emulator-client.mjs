// Tiện ích dùng chung cho các script chạy với Firebase Emulator (bots, seed-host).
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";

export const PROJECT_ID = process.env.FIREBASE_PROJECT ?? "demo-giatreoco";
export const EMULATOR_HOST = process.env.EMULATOR_HOST ?? "127.0.0.1";
export const DB_NAMESPACE = `${PROJECT_ID}-default-rtdb`;
export const HOST_EMAIL = "host@example.com";
export const HOST_PASSWORD = "matkhau-host-123";

const config = {
  apiKey: "demo-api-key",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  databaseURL: `https://${DB_NAMESPACE}.firebaseio.com`,
  appId: "1:000000000000:web:demo",
};

let counter = 0;

/** Tạo một client Firebase độc lập (auth riêng) kết nối tới emulator. */
export function createClient(name = `client-${++counter}`) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, EMULATOR_HOST, 9000);
  return { app, auth, db };
}

/** Tạo tài khoản host trên Auth Emulator (nếu chưa có) và cấp quyền host: /admins/{uid} = true. Trả về uid. */
export async function ensureHostUser() {
  const authUrl = `http://${EMULATOR_HOST}:9099/identitytoolkit.googleapis.com/v1/accounts`;
  const body = JSON.stringify({ email: HOST_EMAIL, password: HOST_PASSWORD, returnSecureToken: true });
  const headers = { "Content-Type": "application/json" };
  let res = await fetch(`${authUrl}:signUp?key=demo-api-key`, { method: "POST", headers, body });
  if (!res.ok) res = await fetch(`${authUrl}:signInWithPassword?key=demo-api-key`, { method: "POST", headers, body });
  const data = await res.json();
  if (!data.localId) throw new Error(`Không tạo được host: ${JSON.stringify(data)}`);
  // Trên emulator, token "owner" bỏ qua security rules (giống thao tác tay trên Console).
  const put = await fetch(`http://${EMULATOR_HOST}:9000/admins/${data.localId}.json?ns=${DB_NAMESPACE}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner" },
    body: "true",
  });
  if (!put.ok) throw new Error(`Không ghi được /admins: ${await put.text()}`);
  return data.localId;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
