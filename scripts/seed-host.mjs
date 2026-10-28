// Tạo tài khoản host mẫu trên Auth Emulator và cấp quyền host (/admins/{uid} = true).
import { ensureHostUser, HOST_EMAIL, HOST_PASSWORD } from "./emulator-client.mjs";

const uid = await ensureHostUser();
console.log(`Host trên emulator: ${HOST_EMAIL} / ${HOST_PASSWORD} (uid ${uid}, đã có /admins/${uid} = true)`);
process.exit(0);
