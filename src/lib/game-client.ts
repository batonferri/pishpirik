import { supabase } from "@/integrations/supabase/client";
import { newGame, playCard, type GameState } from "./pishpirik";

export interface Player {
  id: string;
  name: string;
}

const PLAYER_KEY = "pishpirik.player";

export function getLocalPlayer(): Player {
  if (typeof window === "undefined") return { id: "", name: "" };
  const raw = localStorage.getItem(PLAYER_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  const p = { id: crypto.randomUUID(), name: "" };
  localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
  return p;
}

export function setLocalPlayer(p: Player) {
  localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
}

function genCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export interface RoomRow {
  id: string;
  code: string;
  status: "waiting" | "playing" | "finished";
  state: RoomState;
}

export interface RoomState {
  host: Player;
  guest?: Player;
  game?: GameState;
}

export async function createRoom(host: Player): Promise<RoomRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const initial: RoomState = { host };
    const { data, error } = await supabase
      .from("games")
      .insert({ code, status: "waiting", state: initial as never })
      .select()
      .single();
    if (!error && data) return data as unknown as RoomRow;
    if (error && !`${error.message}`.toLowerCase().includes("duplicate")) throw error;
  }
  throw new Error("Could not create a room, try again");
}

export async function fetchRoom(code: string): Promise<RoomRow | null> {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as RoomRow) ?? null;
}

export async function joinRoom(code: string, guest: Player): Promise<RoomRow> {
  const room = await fetchRoom(code);
  if (!room) throw new Error("Room not found");
  if (room.status !== "waiting") {
    // allow rejoin if player is already in the room
    const st = room.state;
    if (st.host?.id === guest.id || st.guest?.id === guest.id) return room;
    throw new Error("Room is full or already started");
  }
  if (room.state.host.id === guest.id) return room; // host reopening
  const newState: RoomState = {
    ...room.state,
    guest,
    game: newGame(room.state.host, guest),
  };
  const { data, error } = await supabase
    .from("games")
    .update({ status: "playing", state: newState as never })
    .eq("id", room.id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as RoomRow;
}

export async function submitMove(room: RoomRow, playerId: string, cardIdx: number): Promise<void> {
  const state = room.state;
  if (!state.game) throw new Error("Game not started");
  const playerIdx = state.host.id === playerId ? 0 : state.guest?.id === playerId ? 1 : -1;
  if (playerIdx < 0) throw new Error("You are not in this game");
  const next = playCard(state.game, playerIdx as 0 | 1, cardIdx);
  const newState: RoomState = { ...state, game: next };
  const status = next.status === "finished" ? "finished" : "playing";
  const { error } = await supabase
    .from("games")
    .update({ state: newState as never, status })
    .eq("id", room.id);
  if (error) throw error;
}

export async function restartMatch(room: RoomRow): Promise<void> {
  const { host, guest } = room.state;
  if (!guest) throw new Error("No opponent");
  const newState: RoomState = { host, guest, game: newGame(host, guest) };
  const { error } = await supabase
    .from("games")
    .update({ state: newState as never, status: "playing" })
    .eq("id", room.id);
  if (error) throw error;
}
