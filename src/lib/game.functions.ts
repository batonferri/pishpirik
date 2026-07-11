// Server functions: the ONLY code path that may mutate a room.
// Clients send intentions (join, play card X, vote rematch); everything is
// validated here against the private state in game_secrets and persisted
// atomically through the apply_game_update() SQL function (optimistic CAS
// on games.version), so concurrent/duplicate events can never fork the game.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ABANDON_GRACE_MS,
  applyMove,
  createPrivateRoom,
  encodeError,
  expireRematch,
  forfeitGame,
  GameError,
  identify,
  idleRematch,
  rematchAction,
  ROOM_TTL_HOURS,
  roomStatusOf,
  seatGuest,
  toMyView,
  toPublicState,
  type PrivateRoomState,
  type PublicRoom,
} from "./room-engine";
import type { Card, Rank, Suit } from "./pishpirik";

// ---------- schemas ----------

const playerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(20),
});

const codeSchema = z
  .string()
  .trim()
  .min(4)
  .max(8)
  .transform((s) => s.toUpperCase());

const tokenSchema = z.string().min(1).max(128);

const cardSchema = z.object({
  s: z.enum(["S", "H", "D", "C"]) as z.ZodType<Suit>,
  r: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) as z.ZodType<Rank>,
});

// ---------- db helpers (server only) ----------

interface LoadedRoom {
  id: string;
  code: string;
  status: string;
  version: number;
  priv: PrivateRoomState;
  hostSeen: string | null;
  guestSeen: string | null;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function loadRoom(code: string): Promise<LoadedRoom> {
  const admin = await getAdmin();
  const { data: row, error } = await admin
    .from("games")
    .select("id, code, status, version, game_secrets(state, host_seen, guest_seen)")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new GameError("ROOM_NOT_FOUND", "Room not found");
  const secretRows = row.game_secrets as unknown as
    | { state: PrivateRoomState; host_seen: string | null; guest_seen: string | null }[]
    | { state: PrivateRoomState; host_seen: string | null; guest_seen: string | null }
    | null;
  const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
  if (!secret) throw new GameError("ROOM_NOT_FOUND", "Room not found");
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    version: row.version as number,
    priv: secret.state,
    hostSeen: secret.host_seen,
    guestSeen: secret.guest_seen,
  };
}

/** Atomic CAS persist. Throws VERSION_CONFLICT if someone else wrote first. */
async function persist(room: LoadedRoom, nextPriv: PrivateRoomState): Promise<number> {
  const admin = await getAdmin();
  const { data, error } = await admin.rpc("apply_game_update", {
    p_id: room.id,
    p_expected_version: room.version,
    p_status: roomStatusOf(nextPriv),
    p_public: toPublicState(nextPriv) as never,
    p_private: nextPriv as never,
  });
  if (error) {
    if (`${error.message}`.includes("VERSION_CONFLICT")) {
      throw new GameError("VERSION_CONFLICT");
    }
    throw new Error(error.message);
  }
  return data;
}

/** Retry a load→mutate→CAS cycle a few times so racing writers serialize. */
async function withRoom(
  code: string,
  mutate: (room: LoadedRoom) => PrivateRoomState,
): Promise<{ room: PublicRoom; priv: PrivateRoomState }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const room = await loadRoom(code);
    const nextPriv = mutate(room);
    try {
      const version = await persist(room, nextPriv);
      return {
        room: {
          id: room.id,
          code: room.code,
          status: roomStatusOf(nextPriv),
          version,
          state: toPublicState(nextPriv),
        },
        priv: nextPriv,
      };
    } catch (e) {
      lastErr = e;
      if (e instanceof GameError && e.code === "VERSION_CONFLICT") continue;
      throw e;
    }
  }
  throw lastErr ?? new GameError("VERSION_CONFLICT");
}

async function touchSeen(roomId: string, playerIdx: 0 | 1) {
  const admin = await getAdmin();
  const now = new Date().toISOString();
  await admin
    .from("game_secrets")
    .update(playerIdx === 0 ? { host_seen: now } : { guest_seen: now })
    .eq("game_id", roomId);
}

function toPublicRoom(room: LoadedRoom): PublicRoom {
  return {
    id: room.id,
    code: room.code,
    status: roomStatusOf(room.priv),
    version: room.version,
    state: toPublicState(room.priv),
  };
}

function genCode(): string {
  // 6 chars from a 31-symbol alphabet (no 0/O/1/I/L) ≈ 887M combinations.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

// ---------- server functions ----------

export const createRoomFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ host: playerSchema }).parse(d))
  .handler(async ({ data }) => {
    try {
      const admin = await getAdmin();

      // Opportunistic cleanup of stale rooms (cascades to game_secrets).
      const cutoff = new Date(Date.now() - ROOM_TTL_HOURS * 3600_000).toISOString();
      await admin.from("games").delete().lt("updated_at", cutoff);

      const hostToken = crypto.randomUUID();
      const priv = createPrivateRoom(data.host, hostToken);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = genCode();
        const { data: row, error } = await admin
          .from("games")
          .insert({ code, status: "waiting", state: toPublicState(priv) as never })
          .select("id, code, status, version")
          .single();
        if (error) {
          if (`${error.message}`.toLowerCase().includes("duplicate")) continue;
          throw new Error(error.message);
        }
        const { error: sErr } = await admin
          .from("game_secrets")
          .insert({ game_id: row.id, state: priv as never, host_seen: new Date().toISOString() });
        if (sErr) throw new Error(sErr.message);
        const room: PublicRoom = {
          id: row.id,
          code: row.code,
          status: "waiting",
          version: row.version as number,
          state: toPublicState(priv),
        };
        return { room, token: hostToken };
      }
      throw new Error("Could not create a room, try again");
    } catch (e) {
      throw encodeError(e);
    }
  });

export const fetchRoomFn = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: codeSchema }).parse(d))
  .handler(async ({ data }) => {
    try {
      const room = await loadRoom(data.code);
      return toPublicRoom(room);
    } catch (e) {
      throw encodeError(e);
    }
  });

/**
 * Join a room. If a valid seat token is supplied, this is a reconnect and the
 * original seat is reclaimed — a different user can never take it over.
 */
export const joinRoomFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        code: codeSchema,
        guest: playerSchema,
        token: tokenSchema.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      // Reconnect path: token identifies the seat, nothing changes server-side.
      if (data.token) {
        const room = await loadRoom(data.code);
        try {
          const playerIdx = identify(room.priv, data.token);
          await touchSeen(room.id, playerIdx);
          return { room: toPublicRoom(room), token: data.token, playerIdx };
        } catch {
          // fall through to a fresh join below
        }
      }

      const guestToken = crypto.randomUUID();
      const { room } = await withRoom(data.code, (r) => seatGuest(r.priv, data.guest, guestToken));
      const admin = await getAdmin();
      await admin
        .from("game_secrets")
        .update({ guest_seen: new Date().toISOString() })
        .eq("game_id", room.id);
      return { room, token: guestToken, playerIdx: 1 as const };
    } catch (e) {
      throw encodeError(e);
    }
  });

/** Personalized snapshot: the caller's hand plus the authoritative public room. */
export const myViewFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: codeSchema, token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    try {
      const room = await loadRoom(data.code);
      const playerIdx = identify(room.priv, data.token);
      await touchSeen(room.id, playerIdx);
      return { room: toPublicRoom(room), view: toMyView(room.priv, playerIdx) };
    } catch (e) {
      throw encodeError(e);
    }
  });

export const submitMoveFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        code: codeSchema,
        token: tokenSchema,
        card: cardSchema,
        gameNo: z.number().int().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      let playerIdx: 0 | 1 = 0;
      const { room, priv } = await withRoom(data.code, (r) => {
        playerIdx = identify(r.priv, data.token);
        return applyMove(r.priv, playerIdx, data.card as Card, data.gameNo);
      });
      return { room, view: toMyView(priv, playerIdx) };
    } catch (e) {
      throw encodeError(e);
    }
  });

export const rematchFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        code: codeSchema,
        token: tokenSchema,
        action: z.enum(["request", "accept", "decline"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      let started = false;
      let playerIdx: 0 | 1 = 0;
      const { room, priv } = await withRoom(data.code, (r) => {
        playerIdx = identify(r.priv, data.token);
        const result = rematchAction(r.priv, playerIdx, data.action, Date.now());
        started = result.started;
        return result.priv;
      });
      const view = started ? toMyView(priv, playerIdx) : null;
      return { room, started, view };
    } catch (e) {
      throw encodeError(e);
    }
  });

/** Lightweight liveness ping; also lazily expires stale rematch requests. */
export const heartbeatFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: codeSchema, token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    try {
      const room = await loadRoom(data.code);
      const playerIdx = identify(room.priv, data.token);
      await touchSeen(room.id, playerIdx);
      const expired = expireRematch(room.priv, Date.now());
      if (expired !== room.priv) {
        try {
          await persist(room, expired);
        } catch {
          // someone else already wrote — fine, they own the update
        }
      }
      return { ok: true };
    } catch (e) {
      throw encodeError(e);
    }
  });

/**
 * Claim the win after the opponent's reconnect grace period ran out.
 * Server-validated against the opponent's last heartbeat — the remaining
 * client merely triggers the check.
 */
export const claimAbandonedFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: codeSchema, token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    try {
      const probe = await loadRoom(data.code);
      const callerIdx = identify(probe.priv, data.token);
      const oppSeen = callerIdx === 0 ? probe.guestSeen : probe.hostSeen;
      const oppAge = oppSeen ? Date.now() - new Date(oppSeen).getTime() : Infinity;
      if (oppAge < ABANDON_GRACE_MS) {
        throw new GameError("OPPONENT_STILL_CONNECTED", "Your opponent is still connected");
      }
      const { room } = await withRoom(data.code, (r) => {
        const idx = identify(r.priv, data.token);
        return forfeitGame(r.priv, idx, "abandoned");
      });
      return { room };
    } catch (e) {
      throw encodeError(e);
    }
  });

/** Explicit leave: forfeits a running game, or deletes a still-waiting room. */
export const leaveRoomFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: codeSchema, token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    try {
      const room = await loadRoom(data.code);
      const playerIdx = identify(room.priv, data.token);
      if (!room.priv.game) {
        const admin = await getAdmin();
        await admin.from("games").delete().eq("id", room.id);
        return { ok: true };
      }
      if (room.priv.game.status !== "finished") {
        const winnerIdx: 0 | 1 = playerIdx === 0 ? 1 : 0;
        await withRoom(data.code, (r) => forfeitGame(r.priv, winnerIdx, "forfeit"));
      } else {
        // Leaving after the game ended cancels any pending rematch.
        const leaverId = playerIdx === 0 ? room.priv.host.id : room.priv.guest!.id;
        await withRoom(data.code, (r) => ({
          ...r.priv,
          rematch: { ...idleRematch(), status: "declined" as const, declinedBy: leaverId },
        }));
      }
      return { ok: true };
    } catch (e) {
      throw encodeError(e);
    }
  });
