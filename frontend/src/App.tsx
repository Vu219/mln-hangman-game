import { Link, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import HostLogin from "./pages/HostLogin";
import HostDashboard from "./pages/HostDashboard";
import HostRoom from "./pages/HostRoom";
import Play from "./pages/Play";
import { usingEmulator } from "./firebase";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/login" element={<HostLogin />} />
        <Route path="/host" element={<HostDashboard />} />
        <Route path="/host/:pin" element={<HostRoom />} />
        <Route path="/play/:pin" element={<Play />} />
        <Route
          path="*"
          element={
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="title-display text-3xl">Không tìm thấy trang</p>
              <Link to="/" className="btn-gold">
                Về trang chủ
              </Link>
            </div>
          }
        />
      </Routes>
      {usingEmulator && (
        <div className="pointer-events-none fixed bottom-1 left-1 z-50 rounded bg-coal-950/80 px-2 py-0.5 text-[10px] font-bold text-gold-300/70">
          EMULATOR
        </div>
      )}
    </>
  );
}
