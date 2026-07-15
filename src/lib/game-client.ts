// Client-side helpers: local identity, per-room seat tokens, and friendly
// error messages. All game mutations go through the server functions in
// game.functions.ts — the browser never writes to the database directly.

import { decodeErrorCode, type GameErrorCode } from "./room-engine";
import {
  readRoomToken,
  readStoredPlayer,
  removeRoomToken,
  writeRoomToken,
  writeStoredPlayer,
  type Player,
} from "./browser-storage";
import { translate } from "./i18n";

export type { Player };

export const createId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function getLocalPlayer(): Player {
  if (typeof window === "undefined") return { id: "", name: "" };
  const stored = readStoredPlayer();
  if (stored) return stored;
  const p = { id: createId(), name: "" };
  writeStoredPlayer(p);
  return p;
}

export function setLocalPlayer(p: Player) {
  writeStoredPlayer(p);
}

/** The seat token is the credential for a room; keep one per room code. */
export function getRoomToken(code: string): string | null {
  if (typeof window === "undefined") return null;
  return readRoomToken(code);
}

export function setRoomToken(code: string, token: string) {
  writeRoomToken(code, token);
}

export function clearRoomToken(code: string) {
  removeRoomToken(code);
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
