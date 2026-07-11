// Client-side helpers: local identity, per-room seat tokens, and friendly
// error messages. All game mutations go through the server functions in
// game.functions.ts — the browser never writes to the database directly.

import { decodeErrorCode, type GameErrorCode } from "./room-engine";

export interface Player {
  id: string;
  name: string;
}

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
  const p = { id: crypto.randomUUID(), name: "" };
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

const FRIENDLY: Record<GameErrorCode, string> = {
  ROOM_NOT_FOUND: "That room doesn't exist (or it expired).",
  ROOM_FULL: "This room already has two players.",
  NOT_A_ROOM_PLAYER: "You are not a player in this room.",
  ALREADY_IN_ROOM: "You are already in this room — open your original tab or rejoin.",
  NOT_YOUR_TURN: "It's not your turn yet.",
  INVALID_CARD: "You can't play that card.",
  GAME_ALREADY_STARTED: "This game has already started.",
  GAME_NOT_STARTED: "The game hasn't started yet.",
  GAME_FINISHED: "The game is already over.",
  REMATCH_NOT_AVAILABLE: "A rematch isn't available right now.",
  STALE_EVENT: "That action was out of date — the game has moved on.",
  OPPONENT_STILL_CONNECTED: "Your opponent is still connected.",
  VERSION_CONFLICT: "The game updated at the same time — please try again.",
  INVALID_ACTION: "That action isn't possible right now.",
};

export function errorCodeOf(e: unknown): GameErrorCode | null {
  if (e instanceof Error) return decodeErrorCode(e.message);
  return null;
}

export function friendlyError(e: unknown, fallback = "Something went wrong"): string {
  const code = errorCodeOf(e);
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  if (e instanceof Error && e.message && !e.message.startsWith("[")) return e.message;
  return fallback;
}
