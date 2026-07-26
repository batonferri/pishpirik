// Lightweight Web Audio SFX for the table — no asset files.
// Sounds stay silent until the browser unlocks audio (first user gesture).

import { readStoredMuted, writeStoredMuted } from "./browser-storage";

export type SoundName = "deal" | "play" | "capture" | "pishti" | "chat" | "win" | "lose";

let ctx: AudioContext | null = null;
let muted = false;
let unlocked = false;
let listenersBound = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function unlock() {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  unlocked = c.state === "running";
}

function ensureGestureUnlock() {
  if (typeof window === "undefined" || listenersBound) return;
  listenersBound = true;
  const once = () => {
    unlock();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once, { passive: true });
  window.addEventListener("keydown", once);
}

export function initSounds(): void {
  if (typeof window === "undefined") return;
  muted = readStoredMuted();
  ensureGestureUnlock();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  writeStoredMuted(next);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

function tone(
  c: AudioContext,
  {
    freq,
    type = "sine",
    start,
    dur,
    gain = 0.08,
    attack = 0.008,
    decay,
    freqEnd,
  }: {
    freq: number;
    type?: OscillatorType;
    start: number;
    dur: number;
    gain?: number;
    attack?: number;
    decay?: number;
    freqEnd?: number;
  },
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + dur);
  const peak = Math.max(0.0001, gain);
  const rel = decay ?? dur * 0.85;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(attack + 0.01, rel));
  osc.connect(g);
  g.connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noiseBurst(
  c: AudioContext,
  {
    start,
    dur,
    gain = 0.05,
    hp = 800,
    lp = 4200,
  }: { start: number; dur: number; gain?: number; hp?: number; lp?: number },
) {
  const samples = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, samples, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = (hp + lp) / 2;
  filter.Q.value = 0.7;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(start);
  src.stop(start + dur + 0.02);
}

function playDeal(c: AudioContext, t0: number) {
  for (let i = 0; i < 4; i++) {
    const t = t0 + i * 0.055;
    noiseBurst(c, { start: t, dur: 0.05, gain: 0.04, hp: 1200, lp: 5000 });
    tone(c, { freq: 220 + i * 18, type: "triangle", start: t, dur: 0.06, gain: 0.03 });
  }
}

function playCard(c: AudioContext, t0: number) {
  noiseBurst(c, { start: t0, dur: 0.07, gain: 0.055, hp: 900, lp: 3800 });
  tone(c, { freq: 180, type: "triangle", start: t0, dur: 0.09, gain: 0.04, freqEnd: 120 });
}

function playCapture(c: AudioContext, t0: number) {
  noiseBurst(c, { start: t0, dur: 0.1, gain: 0.045, hp: 600, lp: 2800 });
  tone(c, { freq: 320, type: "sine", start: t0, dur: 0.12, gain: 0.05, freqEnd: 480 });
  tone(c, { freq: 480, type: "sine", start: t0 + 0.07, dur: 0.14, gain: 0.04, freqEnd: 640 });
}

function playPishti(c: AudioContext, t0: number) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    tone(c, {
      freq,
      type: "triangle",
      start: t0 + i * 0.08,
      dur: 0.22,
      gain: 0.07,
      decay: 0.2,
    });
  });
}

function playChat(c: AudioContext, t0: number) {
  tone(c, { freq: 880, type: "sine", start: t0, dur: 0.06, gain: 0.035, freqEnd: 1200 });
  tone(c, { freq: 1320, type: "sine", start: t0 + 0.04, dur: 0.07, gain: 0.025 });
}

function playWin(c: AudioContext, t0: number) {
  [392, 523.25, 659.25].forEach((freq, i) => {
    tone(c, { freq, type: "triangle", start: t0 + i * 0.1, dur: 0.28, gain: 0.06, decay: 0.25 });
  });
}

function playLose(c: AudioContext, t0: number) {
  tone(c, { freq: 330, type: "sine", start: t0, dur: 0.22, gain: 0.05, freqEnd: 220 });
  tone(c, { freq: 220, type: "triangle", start: t0 + 0.14, dur: 0.28, gain: 0.04, freqEnd: 160 });
}

const PLAYERS: Record<SoundName, (c: AudioContext, t0: number) => void> = {
  deal: playDeal,
  play: playCard,
  capture: playCapture,
  pishti: playPishti,
  chat: playChat,
  win: playWin,
  lose: playLose,
};

export function playSound(name: SoundName): void {
  if (muted || typeof window === "undefined") return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().then(() => {
      unlocked = c.state === "running";
      if (unlocked && !muted) PLAYERS[name](c, c.currentTime + 0.01);
    });
    return;
  }
  unlocked = true;
  PLAYERS[name](c, c.currentTime + 0.01);
}
