// Âm thanh tổng hợp bằng WebAudio (không cần file), có thể tắt và nhớ lựa chọn.
import { useEffect, useState, useSyncExternalStore } from "react";

const KEY = "gtc-muted";
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* bỏ qua */
  }
  if (muted) haltMusic();
  else if (wantedTrack) startMusic(wantedTrack);
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
  );
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function voice(ac: AudioContext, out: AudioNode, freq: number, t: number, dur: number, type: OscillatorType, gain: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Âm vực trượt (dùng cho tiếng "vút", trống kick). */
function sweep(ac: AudioContext, out: AudioNode, from: number, to: number, t: number, dur: number, type: OscillatorType, gain: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.08);
}

let noise: AudioBuffer | null = null;

/** Tiếng nhiễu đã lọc: trống snare, hi-hat, chũm choẹ, tiếng vỗ tay. */
function hit(ac: AudioContext, out: AudioNode, t: number, dur: number, gain: number, freq: number, type: BiquadFilterType = "highpass") {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise;
  filter.type = type;
  filter.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

/** Phát một hiệu ứng: `play(ac, out, t0)` nhận thời điểm bắt đầu. */
function fx(play: (ac: AudioContext, out: AudioNode, t0: number) => void) {
  const ac = audio();
  if (ac) play(ac, ac.destination, ac.currentTime + 0.01);
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "square", gain = 0.08) {
  fx((ac, out, t) => voice(ac, out, freq, t + start, dur, type, gain));
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export const sfx = {
  tick: () => tone(880, 0, 0.05, "square", 0.04),
  join: () => {
    tone(660, 0, 0.08);
    tone(990, 0.08, 0.12);
  },
  correct: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.18, "triangle", 0.1)),
  wrong: () => {
    tone(220, 0, 0.25, "sawtooth", 0.08);
    tone(160, 0.2, 0.35, "sawtooth", 0.08);
  },
  stroke: () => {
    tone(110, 0, 0.18, "sawtooth", 0.12);
    tone(70, 0.1, 0.3, "square", 0.1);
  },
  hanged: () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.22, 0.3, "sawtooth", 0.09)),
  reveal: () => {
    tone(392, 0, 0.1, "triangle");
    tone(587, 0.1, 0.25, "triangle");
  },
  round: () => [196, 262, 330, 392].forEach((f, i) => tone(f, i * 0.12, 0.3, "square", 0.06)),

  /** Tiếng bíp đếm ngược "Chuẩn bị!" (n giây còn lại). */
  count: (n: number) => tone(n <= 1 ? 784 : 587, 0, 0.18, "square", 0.08),
  /** Bắt đầu được chọn đáp án. */
  go: () =>
    fx((ac, out, t) => {
      voice(ac, out, 784, t, 0.12, "square", 0.08);
      voice(ac, out, 1175, t + 0.1, 0.35, "square", 0.08);
      hit(ac, out, t + 0.1, 0.3, 0.15, 6000);
    }),
  /** Chạm chọn một ô (nối cặp, sắp xếp). */
  select: () => tone(1250, 0, 0.05, "triangle", 0.07),
  /** Nộp bài thành công. */
  submit: () => fx((ac, out, t) => sweep(ac, out, 400, 1400, t, 0.18, "triangle", 0.09)),
  /** Màn hình host: có người vừa trả lời. */
  answered: () => tone(1568, 0, 0.06, "sine", 0.05),
  /** Hết giờ. */
  timeUp: () =>
    fx((ac, out, t) => {
      voice(ac, out, 180, t, 0.6, "sawtooth", 0.09);
      voice(ac, out, 185, t, 0.6, "square", 0.05);
    }),

  /** Trống dồn trước khi xướng tên (giây). */
  drumroll: (sec: number) =>
    fx((ac, out, t) => {
      const n = Math.floor(sec / 0.045);
      for (let i = 0; i < n; i++) hit(ac, out, t + i * 0.045, 0.06, 0.04 + (0.22 * i) / n, 900, "bandpass");
    }),
  /** Xướng tên hạng 3 / 2 / 1. */
  place: (rank: 1 | 2 | 3) =>
    fx((ac, out, t) => {
      hit(ac, out, t, rank === 1 ? 2.2 : 0.9, rank === 1 ? 0.35 : 0.22, 3500); // chũm choẹ
      sweep(ac, out, 150, 45, t, 0.25, "sine", 0.8); // trống cái
      const melodies: Record<number, number[]> = {
        3: [67, 72],
        2: [67, 72, 76],
        1: [67, 67, 67, 72, 76, 79, 76, 79, 84],
      };
      const gap = rank === 1 ? 0.13 : 0.12;
      melodies[rank].forEach((n, i) => {
        const last = i === melodies[rank].length - 1;
        voice(ac, out, midi(n), t + i * gap, last ? 0.9 : 0.16, "square", 0.07);
        voice(ac, out, midi(n - 12), t + i * gap, last ? 0.9 : 0.16, "triangle", 0.09);
      });
      if (rank === 1) {
        // Tiếng vỗ tay: nhiều tiếng "bốp" ngẫu nhiên trong 3 giây.
        for (let i = 0; i < 140; i++) hit(ac, out, t + 0.4 + Math.random() * 3, 0.05, 0.05 + Math.random() * 0.08, 1500, "bandpass");
      }
    }),
};

// ---------------------------------------------------------------------------
// Nhạc nền lặp, phát bằng bộ lập lịch lookahead.
// - lobby: nhạc chờ ở sảnh (La thứ, Am – F – G – E, 124 BPM)
// - thinking: nhạc hồi hộp khi đang chọn đáp án (Rê thứ, Dm – Bb – C – A, 140 BPM)
// ---------------------------------------------------------------------------

interface Track {
  step: number; // độ dài một nốt móc kép (giây)
  length: number; // số bước trong một vòng lặp
  volume: number;
  play: (ac: AudioContext, out: AudioNode, s: number, t: number) => void;
}

const LOBBY_STEP = 60 / 124 / 4;
const LOBBY_CHORDS = [45, 41, 43, 40]; // A2, F2, G2, E2
const LOBBY_BASS = [0, null, null, 0, null, null, 12, null, 0, null, null, 0, null, 7, null, null];
const LOBBY_MELODY = [
  [69, 72, 76, 72, 74, 72, 71, 69],
  [65, 69, 72, 69, 71, 69, 67, 65],
  [67, 71, 74, 71, 72, 71, 69, 67],
  [68, 71, 74, 71, 76, 74, 71, 68],
];

const THINK_STEP = 60 / 140 / 4;
const THINK_CHORDS = [
  [38, 62, 65, 69], // Dm
  [34, 58, 62, 65], // Bb
  [36, 60, 64, 67], // C
  [33, 57, 61, 64], // A
];

const TRACKS = {
  lobby: {
    step: LOBBY_STEP,
    length: 64,
    volume: 0.09,
    play(ac, out, s, t) {
      const bar = Math.floor(s / 16) % 4;
      const i = s % 16;
      const bass = LOBBY_BASS[i];
      if (bass !== null) voice(ac, out, midi(LOBBY_CHORDS[bar] + bass), t, LOBBY_STEP * 1.6, "triangle", 0.5);
      if (i % 2 === 0) voice(ac, out, midi(LOBBY_MELODY[bar][i / 2]), t, LOBBY_STEP * 1.8, "square", 0.12);
      if (i === 0 || i === 8) sweep(ac, out, 140, 40, t, 0.12, "sine", 0.9);
      if (i === 4 || i === 12) hit(ac, out, t, 0.12, 0.35, 1500);
      if (i % 4 === 2) hit(ac, out, t, 0.04, 0.15, 7000);
    },
  },
  thinking: {
    step: THINK_STEP,
    length: 64,
    volume: 0.07,
    play(ac, out, s, t) {
      const bar = Math.floor(s / 16) % 4;
      const i = s % 16;
      const [root, ...tones] = THINK_CHORDS[bar];
      // Bass nhấp nhô từng móc đơn, lên quãng tám ở phách 2 và 4.
      if (i % 2 === 0) voice(ac, out, midi(root + (i % 8 === 4 ? 12 : 0)), t, THINK_STEP * 1.5, "triangle", 0.55);
      // Rải hợp âm liên tục như tiếng đồng hồ suy nghĩ.
      voice(ac, out, midi(tones[[0, 1, 2, 1][i % 4]]), t, THINK_STEP * 0.9, "square", 0.05);
      if (i % 4 === 0) hit(ac, out, t, 0.03, 0.2, 8000); // tích tắc
      if (i === 0) sweep(ac, out, 120, 40, t, 0.14, "sine", 0.7);
      if (i === 12 && bar === 3) hit(ac, out, t, 0.2, 0.15, 2000); // nhấn cuối vòng
    },
  },
} satisfies Record<string, Track>;

export type TrackName = keyof typeof TRACKS;

let wantedTrack: TrackName | null = null;
let playingTrack: TrackName | null = null;
let musicTimer: number | null = null;
let musicGain: GainNode | null = null;

function startMusic(name: TrackName) {
  if (playingTrack === name || muted) return;
  haltMusic();
  const ac = audio();
  if (!ac) return;
  const track: Track = TRACKS[name];
  const gain = ac.createGain();
  gain.gain.value = 0.0001;
  gain.gain.exponentialRampToValueAtTime(track.volume, ac.currentTime + 1.2);
  gain.connect(ac.destination);
  musicGain = gain;
  playingTrack = name;
  let nextTime = ac.currentTime + 0.1;
  let step = 0;
  musicTimer = window.setInterval(() => {
    // Lên lịch trước 0,25 s để nhạc không bị vấp khi tab bận.
    while (nextTime < ac.currentTime + 0.25) {
      track.play(ac, gain, step, nextTime);
      nextTime += track.step;
      step = (step + 1) % track.length;
    }
  }, 50);
}

function haltMusic() {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
  playingTrack = null;
  if (musicGain && ctx) {
    const g = musicGain;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    window.setTimeout(() => g.disconnect(), 500);
  }
  musicGain = null;
}

/**
 * Phát nhạc nền `track` (null = tắt). Trả về `blocked = true` khi trình duyệt chặn tự phát
 * âm thanh (chưa có thao tác nào trên trang) – lúc đó cần một cú bấm để mở khoá.
 */
export function useMusic(track: TrackName | null): { blocked: boolean; unlock: () => void } {
  const isMuted = useMuted();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!track) return;
    wantedTrack = track;
    startMusic(track);
    const check = () => setBlocked(!muted && ctx !== null && ctx.state !== "running");
    check();
    ctx?.addEventListener("statechange", check);
    // Trình duyệt chỉ cho phát sau thao tác đầu tiên của người dùng.
    const resume = () => void ctx?.resume();
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      wantedTrack = null;
      haltMusic();
      ctx?.removeEventListener("statechange", check);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      setBlocked(false);
    };
  }, [track, isMuted]);

  return { blocked: !!track && !isMuted && blocked, unlock: () => void ctx?.resume() };
}
