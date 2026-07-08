import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { newGame, playCard, type GameState } from "./pishpirik";

export interface Player {
  id: string;
  name: string;
}

export interface RoomState {
  host: Player;
  guest?: Player;
  game?: GameState;
  // secrets: never returned to the client
  hostToken: string;
  guestToken?: string;
}

export interface PublicRoomState {
  host: Player;
  guest?: Player;
  game?: GameState;
}

export interface PublicRoom {
  id: string;
  code: string;
  status: "waiting" | "playing" | "finished";
  state: PublicRoomState;
}

function sanitize(row: { id: string; code: string; status: string; state: RoomState }): PublicRoom {
  const { hostToken: _h, guestToken: _g, ...pub } = row.state;
  return {
    id: row.id,
    code: row.code,
    status: row.status as PublicRoom["status"],
    state: pub,
  };
}

function genCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

const playerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(20),
});

export const createRoomFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ host: playerSchema }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hostToken = crypto.randomUUID();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode();
      const state: RoomState = { host: data.host, hostToken };
      const { data: row, error } = await supabaseAdmin
        .from("games")
        .insert({ code, status: "waiting", state: state as never })
        .select()
        .single();
      if (!error && row) {
        return { room: sanitize(row as never), hostToken };
      }
      if (error && !`${error.message}`.toLowerCase().includes("duplicate")) {
        throw new Error(error.message);
      }
    }
    throw new Error("Could not create a room, try again");
  });

export const fetchRoomFn = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().min(1).max(16) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("code", data.code.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return sanitize(row as never);
  });

export const joinRoomFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ code: z.string().min(1).max(16), guest: playerSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.toUpperCase();
    const { data: row, error } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Room not found");
    const state = row.state as unknown as RoomState;

    // If already a participant, return a token if we know one
    if (state.host.id === data.guest.id) {
      return { room: sanitize(row as never), token: state.hostToken, role: "host" as const };
    }
    if (state.guest?.id === data.guest.id && state.guestToken) {
      return { room: sanitize(row as never), token: state.guestToken, role: "guest" as const };
    }
    if (row.status !== "waiting" || state.guest) {
      throw new Error("Room is full or already started");
    }
    const guestToken = crypto.randomUUID();
    const newState: RoomState = {
      ...state,
      guest: data.guest,
      guestToken,
      game: newGame(state.host, data.guest),
    };
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("games")
      .update({ status: "playing", state: newState as never })
      .eq("id", row.id)
      .select()
      .single();
    if (uErr) throw new Error(uErr.message);
    return { room: sanitize(updated as never), token: guestToken, role: "guest" as const };
  });

export const submitMoveFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        code: z.string().min(1).max(16),
        token: z.string().min(1).max(128),
        cardIdx: z.number().int().min(0).max(51),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("code", data.code.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Room not found");
    const state = row.state as unknown as RoomState;
    let playerIdx: 0 | 1;
    if (data.token === state.hostToken) playerIdx = 0;
    else if (data.token === state.guestToken) playerIdx = 1;
    else throw new Error("Not authorized for this room");
    if (!state.game) throw new Error("Game not started");
    const next = playCard(state.game, playerIdx, data.cardIdx);
    const newState: RoomState = { ...state, game: next };
    const status = next.status === "finished" ? "finished" : "playing";
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("games")
      .update({ state: newState as never, status })
      .eq("id", row.id)
      .select()
      .single();
    if (uErr) throw new Error(uErr.message);
    return sanitize(updated as never);
  });

export const restartMatchFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ code: z.string().min(1).max(16), token: z.string().min(1).max(128) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("code", data.code.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Room not found");
    const state = row.state as unknown as RoomState;
    if (data.token !== state.hostToken && data.token !== state.guestToken) {
      throw new Error("Not authorized for this room");
    }
    if (!state.guest) throw new Error("No opponent");
    const newState: RoomState = {
      ...state,
      game: newGame(state.host, state.guest),
    };
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("games")
      .update({ state: newState as never, status: "playing" })
      .eq("id", row.id)
      .select()
      .single();
    if (uErr) throw new Error(uErr.message);
    return sanitize(updated as never);
  });
