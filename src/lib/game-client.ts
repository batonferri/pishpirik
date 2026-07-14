// Client-side helpers: local identity, per-room seat tokens, and friendly
// error messages. All game mutations go through the server functions in
// game.functions.ts — the browser never writes to the database directly.

import { decodeErrorCode, type GameErrorCode } from "./room-engine";
import { translate } from "./i18n";

export interface Player {
  id: string;
  name: string;
}

export const createId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const PLAYER_KEY = "pishpirik.player";
const TOKEN_KEY_PREFIX = "pishpirik.token.";

export function getLocalPlayer(): Player {
  if (typeof window === "undefined") return { id: "", name: "" };
  const raw = localStorage.getItem(PLAYER_KEY);
  if (raw) {
    try {
      const p = JSON.parse(raw) as Player;
      if (p && typeof p.id === "string" && p.id) return p;
    } catch {
      // corrupted — regenerate below
    }
  }
  const p = { id: createId(), name: "" };
  localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
  return p;
}

export function setLocalPlayer(p: Player) {
  localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
}

/** The seat token is the credential for a room; keep one per room code. */
export function getRoomToken(code: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY_PREFIX + code.toUpperCase());
}

export function setRoomToken(code: string, token: string) {
  localStorage.setItem(TOKEN_KEY_PREFIX + code.toUpperCase(), token);
}

export function clearRoomToken(code: string) {
  localStorage.removeItem(TOKEN_KEY_PREFIX + code.toUpperCase());
}

export function errorCodeOf(e: unknown): GameErrorCode | null {
  if (e instanceof Error) return decodeErrorCode(e.message);
  return null;
}

export function friendlyError(e: unknown, fallback?: string): string {
  const code = errorCodeOf(e);
  if (code) return translate(`error.${code}`);
  if (e instanceof Error && e.message && !e.message.startsWith("[")) return e.message;
  return fallback ?? translate("somethingWentWrong");
}
