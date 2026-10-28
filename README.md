# Giá Treo Cổ Của Tư Bản

Game nhiều người chơi kiểu Kahoot cho buổi thuyết trình **Kinh tế chính trị Mác – Lênin**, chủ đề
**“Từ độc quyền dầu mỏ đến độc quyền dữ liệu”**. Host chiếu câu hỏi lên màn hình lớn, người chơi
trả lời trên điện thoại. Mỗi người có 7 nét treo cổ – sai, hết giờ hay bỏ lỡ đều bị vẽ thêm một nét.

Chạy hoàn toàn trên **gói Firebase Spark (miễn phí)**: chỉ dùng Realtime Database + Authentication, **không có Cloud Functions**.

```
/frontend            React + Vite + TypeScript + Tailwind, Firebase Web SDK v10 (deploy Vercel)
  src/game           Logic thuần: chấm điểm, bỏ dấu tiếng Việt, luật 7 nét, gói cứu trợ, phá hoà, schema zod (+ unit test vitest)
  src/host/engine.ts Bộ máy host: tạo phòng, chuyển câu, chấm bài, hiện đáp án – chạy trong trình duyệt của host
  src/lib/playerActions.ts  Vào phòng, nộp bài, đoán chữ – người chơi ghi thẳng vào database
  src/data           questions.json – bộ 24 câu mặc định, 4 vòng, đủ 6 dạng + 6 câu "Gói cứu trợ của Nhà nước"
  e2e/               Chạy thử trọn một ván trên emulator (vitest)
/firebase            admins.example.json (mẫu danh sách host), admins.json (của bạn, không commit)
/scripts             bots.mjs (người chơi giả lập), seed-host.mjs (host mẫu trên emulator)
firebase.json, .firebaserc, database.rules.json, database.rules.test.ts
```

## Kiến trúc host-authoritative

Không có server riêng: **trình duyệt của host là nơi chấm điểm**.

1. **Tạo phòng:** host (có trong `/admins`) sinh PIN 6 số ở client, dùng transaction trên `rooms/{pin}/meta` để không trùng,
   rồi ghi bộ câu hỏi đầy đủ (kèm đáp án) vào `roomSecrets/{pin}` – chỉ host của phòng đọc/ghi được.
2. **Vào phòng:** người chơi giữ chỗ nickname bằng transaction ở `rooms/{pin}/nicknames/{nickname-không-dấu}` = uid,
   rồi tự tạo `players/{uid}`. Rules chỉ cho tạo với giá trị khởi đầu (0 điểm, 0 nét, ALIVE, `bailoutUsed = false`…),
   sau đó người chơi chỉ được ghi `online`.
3. **Nộp bài:** người chơi ghi `rooms/{pin}/submissions/{slot}/{uid} = { payload, at: ServerValue.TIMESTAMP }`
   (`slot` = chỉ số câu, hoặc `bailout-{vòng}` cho gói cứu trợ). Rules chỉ nhận **một lần**, đúng lượt đang mở, `at === now`,
   trong khoảng `questionStartedAt ≤ now ≤ deadline`, và đúng người được trả lời (ALIVE với câu thường; HANGED + chưa dùng cứu trợ ở BAILOUT).
   Câu đoán chữ: mỗi chữ là `submissions/{slot}/{uid}/guesses/{A–Z} = ServerValue.TIMESTAMP` (mỗi chữ một lần).
4. **Chấm bài:** trang host lắng nghe `submissions`, chấm bằng `src/game`, ghi kết quả bằng multi-path update vào `players/{uid}`,
   `private/{uid}`, `stats`, lưu bản ghi chấm vào `roomSecrets/{pin}/answers` và đánh dấu `graded`. Thời gian trả lời =
   `at − questionStartedAt` (cả hai đều là server timestamp). Chỉ `hostUid` mới ghi được điểm, nét, trạng thái, `bailoutUsed`,
   `stats`, `currentQuestion`, `meta`.
5. **Host tải lại trang:** trang host nạp lại `roomSecrets`, đọc trạng thái phòng và chấm tiếp các bài chưa chấm; bài đã có kết quả
   thì bỏ qua (không chấm trùng). Nếu host tải lại đúng lúc đang đặt giờ cho câu mới, trang sẽ tự đặt lại.
6. **Kết thúc:** ở bục vinh danh có nút **Xóa phòng** để xoá `rooms/{pin}` và `roomSecrets/{pin}` (không còn hàm dọn dẹp định kỳ).

> ⚠️ Màn hình host luôn hiện dòng **“Không đóng tab này trong khi chơi”** và chỉ báo kết nối. Nếu tab host bị đóng giữa câu,
> bài nộp vẫn được lưu và sẽ được chấm khi mở lại trang `/host/{pin}`; trình duyệt cũng hỏi lại trước khi rời trang.
> Vì đáp án nằm trong trình duyệt của host, máy host nên là máy của người dẫn chương trình (không chia sẻ màn hình devtools 🙂).

## Luật chơi

| Tình huống | Kết quả |
|---|---|
| Trả lời đúng | `round(1000 × (1 − 0.5 × t/T))`, ×1.2 nếu đang 0 nét, ×1.1 nếu 1–2 nét (người đã được cứu luôn ×1), cộng thưởng chuỗi `100 × (số câu đúng liên tiếp − 1)` |
| Sai / hết giờ / không trả lời | +1 nét – **mỗi câu tối đa +1 nét**: câu nối cặp, sắp xếp hay nhiều chỗ trống sai bao nhiêu phần cũng chỉ +1 |
| Câu đoán chữ | Mỗi người có 5 lượt đoán sai. Đoán sai **không** bị cộng nét, chỉ trừ 10% điểm tốc độ mỗi chữ khi giải được. Sai đủ 5 chữ (bảng bị khoá) hoặc hết giờ mà chưa giải được: +1 nét khi hiện đáp án |
| Đủ 7 nét (giá, dây, đầu, thân, tay trái, tay phải, chân) | Bị treo (HANGED) – thành khán giả nhưng vẫn ở bảng xếp hạng |
| Đã được cứu mà đủ 7 nét lần nữa | Bị loại chung cuộc (ELIMINATED) – hiển thị mờ, vẫn ở bảng xếp hạng |
| Xếp hạng (phá hoà) | Điểm cao hơn → ít nét hơn → chưa dùng cứu trợ → tổng thời gian trả lời ít hơn (không trả lời tính bằng cả thời gian giới hạn) |

### Gói cứu trợ của Nhà nước – *"Cứu trợ chỉ trì hoãn, không xóa bỏ mâu thuẫn"*

- Sau mỗi vòng trừ vòng cuối, nếu có người **HANGED và chưa dùng cứu trợ** (`bailoutUsed = false`) thì trò chơi
  chuyển sang trạng thái `BAILOUT` trước màn giới thiệu vòng kế; không ai đủ điều kiện thì bỏ qua.
- Host chọn ngẫu nhiên 1 câu trong `bailoutQuestions` của vòng vừa xong (mọi dạng trừ WORD_GUESS, mặc định 15 giây, cũng có đếm ngược "Chuẩn bị!").
- Chỉ người đủ điều kiện được nộp (rules kiểm tra). Kết quả áp dụng ngay khi host chấm để màn hình đếm realtime "x/y đã được cứu":
  - **Đúng:** về 6 nét, sống lại (ALIVE), `bailoutUsed = true`, mất chuỗi, không cộng điểm, từ đó không còn hệ số nhân.
  - **Sai / hết giờ:** vẫn HANGED, `bailoutUsed = true`.
- Khi hiện đáp án gói cứu trợ, người còn sống không bị cộng nét. Bảng xếp hạng và bục vinh danh có 🩹 cạnh tên người đã được cứu.
- Vì mỗi câu tối đa +1 nét, cần ít nhất 7 câu mới có thể bị treo. Bộ câu mặc định có 7 câu ở vòng 1, nên người sai
  (hoặc bỏ qua) toàn bộ vòng 1 sẽ bị treo đúng lúc hết vòng và được mở gói cứu trợ ngay sau vòng 1.
- File câu hỏi cũ còn dùng `type: "RESCUE"` hoặc trường `"rescue"` sẽ bị từ chối kèm hướng dẫn chuyển sang `bailoutQuestions`.

Sau khi hiện đáp án, điện thoại mỗi người hiện **màn tình trạng treo cổ** của chính mình: vẽ dần các nét vừa bị cộng (rung máy),
"thả cửa sập" và đóng dấu **BỊ TREO!** / **BỊ LOẠI!** khi đủ 7 nét, hoặc phát sáng xanh khi an toàn.

Sau khi host bấm câu tiếp, mọi màn hình đếm ngược **"Chuẩn bị!" 5 giây** (chỉ hiện đề bài) rồi mới hiện đáp án và bắt đầu tính giờ
(đổi độ dài ở `PREROLL_MS` trong `frontend/src/host/engine.ts`). Host ghi `shownAt = ServerValue.TIMESTAMP` rồi đặt
`questionStartedAt = shownAt + 5 giây`, `deadline = questionStartedAt + thời gian`; client bù lệch bằng `.info/serverTimeOffset`.
Đáp án chỉ nằm trong `roomSecrets` (người chơi không đọc được); kết quả từng người chỉ được công bố khi host bấm **Hiện đáp án**.

## Chạy trên máy (Firebase Emulator Suite)

Yêu cầu: Node.js 20+ và Java 11+. Không cần project Firebase thật – emulator dùng project `demo-giatreoco`, chỉ bật **auth + database**.

```bash
npm run install:all
```

```bash
npm run emulators
```

Trong một terminal khác:

```bash
npm run seed:host
```

```bash
npm --prefix frontend run dev
```

- `seed:host` tạo tài khoản host trên emulator `host@example.com` / `matkhau-host-123` và ghi `/admins/{uid} = true` cho tài khoản đó.
- Mở http://localhost:5173/host/login để đăng nhập host → **Tạo phòng & lấy mã PIN**.
- Người chơi mở http://127.0.0.1:5173 (hoặc quét QR). Muốn thử nhiều người trên một máy, dùng các origin khác nhau
  (`localhost`, `127.0.0.1`, cửa sổ ẩn danh…) vì Anonymous Auth giữ một uid cho mỗi origin.
- Thả người chơi giả lập vào phòng (tab host phải đang mở để chấm điểm): `npm run bots -- <PIN> 5`

> Thử bằng điện thoại trong cùng mạng LAN: thêm `"host": "0.0.0.0"` cho các emulator trong `firebase.json`, rồi mở
> `http://<IP-máy-tính>:5173`. Frontend tự kết nối emulator theo hostname của trang (hoặc đặt `VITE_EMULATOR_HOST`).

### Kiểm thử

```bash
npm test
```

- `npm run test:game` – 47 unit test cho logic game trong `frontend/src/game` (chấm điểm, bỏ dấu, 7 nét, đoán chữ, gói cứu trợ, ELIMINATED, phá hoà, schema).
- `npm run test:rules` – 31 test Security Rules, gồm các ca gian lận: tự sửa điểm/nét/trạng thái/`bailoutUsed`, tự cấp quyền admin, nộp 2 lần,
  giả mạo thời điểm nộp, nộp sau deadline hoặc trong lúc đếm ngược, đọc `roomSecrets`, đọc `private`/bài nộp của người khác,
  người ALIVE nộp câu cứu trợ, người chơi xoá phòng. Dùng namespace riêng `demo-giatreoco-rules` nên không đụng dữ liệu đang chơi thử.
  Nếu emulator đang chạy sẵn: `npx vitest run --config vitest.rules.config.ts`.
- `npm run e2e:ci` – bật emulator (auth + database) và chạy trọn một ván 24 câu với 1 host + 3 người chơi giả lập, dùng đúng bộ máy host
  và thao tác người chơi của app (129 kiểm tra, có **host tải lại trang giữa câu**: bài nộp nằm chờ rồi được chấm khi mở lại, không chấm trùng;
  gói cứu trợ; bị loại; nút Xóa phòng…). Nếu emulator đang chạy sẵn thì dùng `npm run e2e`.

## Bộ câu hỏi

Mặc định dùng `frontend/src/data/questions.json`. Host có thể tải lên file JSON khác ở màn hình tạo phòng (có nút **Tải file mẫu**).
Mọi file đều được validate bằng zod ngay trong trình duyệt host, lỗi báo bằng tiếng Việt kèm số thứ tự câu.

```jsonc
{
  "title": "Tên bộ câu",
  "rounds": [
    { "round": 1, "title": "Tên vòng", "subtitle": "…", "theme": "classic",   // theme: classic | oil | network
      "bailoutQuestions": [                                                  // câu "Gói cứu trợ" sau vòng này (không bắt buộc)
        { "id": "b1", "type": "TRUE_FALSE", "prompt": "…", "answer": true, "explanation": "…" }  // mọi dạng trừ WORD_GUESS, mặc định 15 giây
      ] }
  ],
  "questions": [
    { "id": "q1", "round": 1, "type": "MULTIPLE_CHOICE", "prompt": "…", "timeLimitSec": 20,
      "options": ["A", "B", "C", "D"], "answerIndex": 0, "explanation": "…" },
    { "id": "q2", "round": 1, "type": "TRUE_FALSE", "prompt": "…", "timeLimitSec": 15, "answer": true },
    { "id": "q3", "round": 1, "type": "WORD_GUESS", "prompt": "…", "timeLimitSec": 60, "word": "ĐỘC QUYỀN", "hint": "…" },
    { "id": "q4", "round": 1, "type": "MATCHING", "prompt": "…", "timeLimitSec": 40,
      "pairs": [{ "left": "…", "right": "…" }] },                      // 2–6 cặp
    { "id": "q5", "round": 1, "type": "ORDERING", "prompt": "…", "timeLimitSec": 40,
      "items": ["sớm nhất", "…", "muộn nhất"] },                      // ghi theo thứ tự ĐÚNG, host tự xáo
    { "id": "q6", "round": 1, "type": "FILL_BLANK", "prompt": "Tư bản ___ là …", "timeLimitSec": 30,
      "blanks": [["tài chính", "tai chinh"]] }                       // mỗi "___" một mảng đáp án chấp nhận
  ]
}
```

Đoán chữ và điền khuyết so khớp **bỏ dấu, không phân biệt hoa thường** (Ư, Ứ, Ừ… khớp U; Đ khớp D) nhưng vẫn hiển thị có dấu.
Khi chuyển sang câu có `round` khác, trò chơi hiện màn giới thiệu vòng; vòng 2 vẽ giá treo bằng ống dầu, vòng 3 bằng dây cáp mạng.

## Deploy trên gói Spark (miễn phí)

### 1. Firebase (Realtime Database + Authentication)

1. Tạo project trên https://console.firebase.google.com (giữ gói **Spark**, không cần thẻ thanh toán).
2. **Build > Realtime Database** → tạo database ở vùng **Singapore (asia-southeast1)**.
3. **Build > Authentication > Sign-in method** → bật **Anonymous** (người chơi) và **Email/Password** (host).
   Vào tab **Users** → **Add user** để tạo tài khoản cho từng host.
4. Trỏ Firebase CLI vào project thật:
   ```bash
   npx firebase login
   ```
   ```bash
   npx firebase use --add
   ```
5. Deploy security rules (lệnh duy nhất cần deploy lên Firebase):
   ```bash
   npx firebase deploy --only database
   ```

### 2. Cấp quyền host

Chỉ tài khoản có `/admins/{uid}: true` trong Realtime Database mới tạo được phòng (người dùng không tự cấp được – rules chặn ghi `/admins`).

**Cách 1 – bằng file (khuyên dùng):**

1. Copy file mẫu:
   ```bash
   cp firebase/admins.example.json firebase/admins.json
   ```
2. Mở `firebase/admins.json`, thay UID mẫu bằng UID của từng host (Firebase Console → **Authentication** → **Users** → cột *User UID*).
   Giá trị phải là boolean `true` (không phải chuỗi `"true"`):
   ```json
   {
     "UID_CUA_HOST_1": true,
     "UID_CUA_HOST_2": true
   }
   ```
3. Sau khi đã `firebase login` và `firebase use` đúng project, chạy:
   ```bash
   npm run set-admins
   ```
   Lệnh này dùng `firebase database:update /admins` nên **chỉ thêm/ghi đè các UID trong file**, không xoá dữ liệu khác trong database
   (CLI sẽ hỏi xác nhận trước khi ghi). `firebase/admins.json` đã nằm trong `.gitignore`; chỉ commit `admins.example.json`.

**Cách 2 – bằng tay:** Firebase Console → **Realtime Database** → **Data** → thêm node `admins` → con có key là UID, giá trị `true` (kiểu boolean).

Nếu host đăng nhập mà chưa có quyền, màn hình tạo phòng sẽ hiện UID của tài khoản đó để copy.

### 3. Frontend lên Vercel

1. Lấy cấu hình Web App ở **Project settings > General > Your apps** (tạo Web App nếu chưa có).
2. Trên Vercel: **Add New Project** → import repo → **Root Directory** = `frontend` (Vercel tự nhận Vite; `frontend/vercel.json`
   rewrite mọi route về `index.html` cho SPA).
3. Khai báo **Environment Variables** (xem `frontend/.env.example`):
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_DATABASE_URL` (dạng `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`), `VITE_FIREBASE_APP_ID`.
   Không đặt `VITE_USE_EMULATOR` (hoặc đặt `false`).
4. Deploy, rồi thêm tên miền Vercel vào **Authentication > Settings > Authorized domains** của Firebase.

Chạy frontend local với project thật: copy `frontend/.env.example` thành `frontend/.env.local`, điền giá trị rồi `npm --prefix frontend run dev:prod`.

> Giới hạn gói Spark của Realtime Database: 100 kết nối đồng thời, 1 GB lưu trữ, 10 GB tải xuống/tháng – đủ cho một lớp học
> (tối đa 100 người/phòng, mỗi người một kết nối; host cũng chiếm 1 kết nối). Nhớ bấm **Xóa phòng** sau buổi chơi.

## Ghi chú vận hành

- Host: phím **Enter/Space** = nút chính (Bắt đầu → Vào câu hỏi → Hiện đáp án → Câu tiếp). Mặc định tự hiện đáp án khi hết giờ hoặc khi mọi người đã trả lời.
- Tối đa 100 người/phòng (kiểm tra phía client); nickname không được trùng (so khớp bỏ dấu, không phân biệt hoa thường).
- Người chơi tải lại trang vẫn giữ uid (Anonymous Auth) nên giữ nguyên điểm và số nét; trạng thái online cập nhật qua `onDisconnect`.
- Âm thanh tổng hợp bằng WebAudio (không cần file), có nút tắt/bật (ghi nhớ trên máy):
  - Máy chiếu (host): nhạc chờ ở sảnh, nhạc hồi hộp trong lúc chọn đáp án, tiếng bíp đếm ngược, "tinh" khi có người trả lời,
    còi hết giờ, và ở bục vinh danh là trống dồn trước khi xướng tên hạng 3 → 2 → 1, kèn + chũm choẹ + vỗ tay cho hạng nhất.
  - Điện thoại: tiếng đếm ngược, chạm chọn, nộp bài, hết giờ, đúng/sai, bị cộng nét. Nhạc nền chỉ phát trên máy chiếu.
  - Nếu trình duyệt chặn tự phát âm thanh, màn hình host hiện nút "🎵 Bấm để bật nhạc".
