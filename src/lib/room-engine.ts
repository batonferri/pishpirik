// Pure, server-authoritative room logic for Pishpirik.
// Everything here is side-effect free so it can be unit-tested without a DB:
// server functions load the private state, call these helpers, then persist
// the result atomically (see apply_game_update in the SQL migration).

import { cardEq, newGame, playCard, type Card, type GameState } from "./pishpirik";

// ---------- errors ----------

export type GameErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_A_ROOM_PLAYER"
  | "ALREADY_IN_ROOM"
  | "NOT_YOUR_TURN"
  | "INVALID_CARD"
  | "GAME_ALREADY_STARTED"
  | "GAME_NOT_STARTED"
  | "GAME_FINISHED"
  | "REMATCH_NOT_AVAILABLE"
  | "STALE_EVENT"
  | "OPPONENT_STILL_CONNECTED"
  | "VERSION_CONFLICT"
  | "INVALID_ACTION";

export class GameError extends Error {
  code: GameErrorCode;
  constructor(code: GameErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GameError";
    this.code = code;
  }
}

/** Server functions serialize errors as plain messages; prefix with the code so the client can map it back. */
export function encodeError(e: unknown): Error {
  if (e instanceof GameError) return new Error(`[${e.code}] ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

export function decodeErrorCode(message: string): GameErrorCode | null {
  const m = /^\[([A-Z_]+)\]/.exec(message);
  return m ? (m[1] as GameErrorCode) : null;
}

// ---------- types ----------

export interface Player {
  id: string;
  name: string;
}

export type RoomStatus = "waiting" | "playing" | "finished";

export type RematchStatus = "idle" | "requested" | "declined";

export interface RematchState {
  status: RematchStatus;
  /** playerId -> voted yes */
  votes: Record<string, boolean>;
  requestedBy: string | null;
  requestedAt: number | null; // epoch ms
  declinedBy: string | null;
}

export type EndReason = "score" | "forfeit" | "abandoned" | null;

/** Full room state. Stored in game_secrets.state — never sent to clients. */
export interface PrivateRoomState {
  host: Player;
  guest?: Player;
  hostToken: string;
  guestToken?: string;
  game?: GameState;
  /** 1-based counter, bumped for every new game (incl. rematches). */
  gameNo: number;
  /** Starter of the current/last game. */
  startingTurn: 0 | 1 | null;
  rematch: RematchState;
  endReason: EndReason;
}

export interface PublicPlayerInfo {
  id: string;
  name: string;
  handCount: number;
  capturedCount: number;
  pishtiPoints: number;
  /** Only revealed once the game is finished. */
  captured?: Card[];
  /** Cards won through pishpirik captures — only revealed once the game is finished. */
  pishtiCards?: Card[];
}

export interface PublicGameState {
  deckCount: number;
  pile: Card[];
  players: [PublicPlayerInfo, PublicPlayerInfo];
  turn: 0 | 1;
  status: "playing" | "finished";
  winner: 0 | 1 | "tie" | null;
  scores?: GameState["scores"];
  lastAction: GameState["lastAction"];
}

/** What gets stored in games.state and broadcast over realtime. */
export interface PublicRoomState {
  host: Player;
  guest?: Player;
  gameNo: number;
  startingTurn: 0 | 1 | null;
  rematch: RematchState;
  endReason: EndReason;
  game?: PublicGameState;
}

export interface PublicRoom {
  id: string;
  code: string;
  status: RoomStatus;
  version: number;
  state: PublicRoomState;
}

/** Personalized view: the only place a hand ever leaves the server. */
export interface MyView {
  playerIdx: 0 | 1;
  hand: Card[];
  gameNo: number;
}

// ---------- constants ----------

export const REMATCH_TIMEOUT_MS = 60_000;
export const ABANDON_GRACE_MS = 90_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const ROOM_TTL_HOURS = 24;

export const idleRematch = (): RematchState => ({
  status: "idle",
  votes: {},
  requestedBy: null,
  requestedAt: null,
  declinedBy: null,
});

// ---------- room lifecycle ----------

export function createPrivateRoom(host: Player, hostToken: string): PrivateRoomState {
  return {
    host,
    hostToken,
    gameNo: 0,
    startingTurn: null,
    rematch: idleRematch(),
    endReason: null,
  };
}

export function roomStatusOf(priv: PrivateRoomState): RoomStatus {
  if (!priv.game) return "waiting";
  return priv.game.status === "finished" ? "finished" : "playing";
}

/** Resolve a seat from a secret token. Throws NOT_A_ROOM_PLAYER for anything else. */
export function identify(priv: PrivateRoomState, token: string): 0 | 1 {
  if (token && token === priv.hostToken) return 0;
  if (token && priv.guestToken && token === priv.guestToken) return 1;
  throw new GameError("NOT_A_ROOM_PLAYER", "You are not a player in this room");
}

/**
 * Seat a new guest and start the first game with a random starter.
 * The seat is locked to the issued token from here on.
 */
export function seatGuest(
  priv: PrivateRoomState,
  guest: Player,
  guestToken: string,
  rand: () => number = Math.random,
): PrivateRoomState {
  if (priv.game) throw new GameError("GAME_ALREADY_STARTED", "This game has already started");
  if (priv.guest) throw new GameError("ROOM_FULL", "This room already has two players");
  if (guest.id === priv.host.id)
    throw new GameError("ALREADY_IN_ROOM", "You are already in this room");
  const startingTurn: 0 | 1 = rand() < 0.5 ? 0 : 1;
  return {
    ...priv,
    guest,
    guestToken,
    startingTurn,
    gameNo: 1,
    endReason: null,
    rematch: idleRematch(),
    game: newGame(priv.host, guest, startingTurn),
  };
}

// ---------- moves ----------

/**
 * Play a card identified by rank+suit (not index) so duplicate/stale events
 * are rejected instead of playing the wrong card.
 */
export function applyMove(
  priv: PrivateRoomState,
  playerIdx: 0 | 1,
  card: Card,
  gameNo: number,
): PrivateRoomState {
  if (!priv.game) throw new GameError("GAME_NOT_STARTED", "The game has not started yet");
  if (gameNo !== priv.gameNo)
    throw new GameError("STALE_EVENT", "This action belongs to a previous game");
  if (priv.game.status === "finished")
    throw new GameError("GAME_FINISHED", "The game is already over");
  if (priv.game.turn !== playerIdx) throw new GameError("NOT_YOUR_TURN", "It is not your turn");
  const hand = priv.game.players[playerIdx].hand;
  const cardIdx = hand.findIndex((c) => cardEq(c, card));
  if (cardIdx < 0) throw new GameError("INVALID_CARD", "That card is not in your hand");
  const nextGame = playCard(priv.game, playerIdx, cardIdx);
  return {
    ...priv,
    game: nextGame,
    endReason: nextGame.status === "finished" ? "score" : priv.endReason,
    rematch: nextGame.status === "finished" ? idleRematch() : priv.rematch,
  };
}

// ---------- rematch ----------

export type RematchAction = "request" | "accept" | "decline";

/** Clear a request that has been pending longer than REMATCH_TIMEOUT_MS. */
export function expireRematch(priv: PrivateRoomState, now: number): PrivateRoomState {
  const r = priv.rematch;
  if (
    r.status === "requested" &&
    r.requestedAt !== null &&
    now - r.requestedAt > REMATCH_TIMEOUT_MS
  ) {
    return { ...priv, rematch: idleRematch() };
  }
  return priv;
}

export interface RematchResult {
  priv: PrivateRoomState;
  /** true when both players agreed and a fresh game was dealt */
  started: boolean;
}

export function rematchAction(
  priv: PrivateRoomState,
  playerIdx: 0 | 1,
  action: RematchAction,
  now: number,
): RematchResult {
  if (!priv.game || !priv.guest || priv.game.status !== "finished") {
    throw new GameError("REMATCH_NOT_AVAILABLE", "A rematch is only possible after a game ends");
  }
  if (priv.endReason !== "score") {
    throw new GameError("REMATCH_NOT_AVAILABLE", "Your opponent has left the game");
  }

  const p = expireRematch(priv, now);
  const me = playerIdx === 0 ? p.host : p.guest!;
  const opponent = playerIdx === 0 ? p.guest! : p.host;
  const r = p.rematch;

  if (action === "decline") {
    if (r.status !== "requested") {
      throw new GameError("REMATCH_NOT_AVAILABLE", "There is no rematch request to decline");
    }
    return {
      priv: {
        ...p,
        rematch: { ...idleRematch(), status: "declined", declinedBy: me.id },
      },
      started: false,
    };
  }

  // "request" and "accept" both mean "I vote yes"; the second yes starts the game.
  if (r.votes[me.id]) return { priv: p, started: false }; // duplicate click — no-op
  const votes = { ...r.votes, [me.id]: true };

  if (votes[opponent.id]) {
    return { priv: startNextGame(p), started: true };
  }

  if (action === "accept") {
    // accept without a pending request from the opponent
    throw new GameError("REMATCH_NOT_AVAILABLE", "There is no rematch request to accept");
  }

  return {
    priv: {
      ...p,
      rematch: {
        status: "requested",
        votes,
        requestedBy: me.id,
        requestedAt: now,
        declinedBy: null,
      },
    },
    started: false,
  };
}

/** Deal a fresh game, alternating the starter from the previous game. */
export function startNextGame(priv: PrivateRoomState): PrivateRoomState {
  if (!priv.guest) throw new GameError("INVALID_ACTION", "No opponent in this room");
  const nextStarter: 0 | 1 = priv.startingTurn === 0 ? 1 : 0;
  return {
    ...priv,
    startingTurn: nextStarter,
    gameNo: priv.gameNo + 1,
    endReason: null,
    rematch: idleRematch(),
    game: newGame(priv.host, priv.guest, nextStarter),
  };
}

// ---------- forfeit / abandon ----------

/** End a running game in favor of `winnerIdx` (opponent left or timed out). */
export function forfeitGame(
  priv: PrivateRoomState,
  winnerIdx: 0 | 1,
  reason: "forfeit" | "abandoned",
): PrivateRoomState {
  if (!priv.game) throw new GameError("GAME_NOT_STARTED", "The game has not started yet");
  if (priv.game.status === "finished")
    throw new GameError("GAME_FINISHED", "The game is already over");
  return {
    ...priv,
    endReason: reason,
    rematch: idleRematch(),
    game: { ...priv.game, status: "finished", winner: winnerIdx },
  };
}

// ---------- sanitization ----------

function publicPlayer(p: GameState["players"][0], revealCaptured: boolean): PublicPlayerInfo {
  return {
    id: p.id,
    name: p.name,
    handCount: p.hand.length,
    capturedCount: p.captured.length,
    pishtiPoints: p.pishtiPoints,
    captured: revealCaptured ? p.captured : undefined,
    pishtiCards: revealCaptured ? (p.pishtiCards ?? []) : undefined,
  };
}

/**
 * Strip everything hidden: hands become counts, the deck becomes a count,
 * and tokens never leave the private state.
 */
export function toPublicState(priv: PrivateRoomState): PublicRoomState {
  const g = priv.game;
  return {
    host: priv.host,
    guest: priv.guest,
    gameNo: priv.gameNo,
    startingTurn: priv.startingTurn,
    rematch: priv.rematch,
    endReason: priv.endReason,
    game: g
      ? {
          deckCount: g.deck.length,
          pile: g.pile,
          players: [
            publicPlayer(g.players[0], g.status === "finished"),
            publicPlayer(g.players[1], g.status === "finished"),
          ],
          turn: g.turn,
          status: g.status === "finished" ? "finished" : "playing",
          winner: g.winner,
          scores: g.scores,
          lastAction: g.lastAction,
        }
      : undefined,
  };
}

export function toMyView(priv: PrivateRoomState, playerIdx: 0 | 1): MyView {
  return {
    playerIdx,
    hand: priv.game ? priv.game.players[playerIdx].hand : [],
    gameNo: priv.gameNo,
  };
}
