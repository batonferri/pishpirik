import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  friendlyError,
  getLocalPlayer,
  getRoomToken,
  setLocalPlayer,
  setRoomToken,
} from "@/lib/game-client";
import { createRoomFn, joinRoomFn } from "@/lib/game.functions";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = getLocalPlayer();
    if (p.name) setName(p.name);
  }, []);

  const persistName = () => {
    const p = getLocalPlayer();
    const next = { ...p, name: name.trim() || "Player" };
    setLocalPlayer(next);
    return next;
  };

  const handleCreate = async () => {
    setError(null);
    setLoading("create");
    try {
      const player = persistName();
      const { room, token } = await createRoomFn({ data: { host: player } });
      setRoomToken(room.code, token);
      navigate({ to: "/game/$code", params: { code: room.code } });
    } catch (e) {
      setError(friendlyError(e, "Failed to create room"));
      setLoading(null);
    }
  };

  const handleJoin = async () => {
    setError(null);
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Enter a room code");
      return;
    }
    setLoading("join");
    try {
      const player = persistName();
      const existingToken = getRoomToken(trimmed) ?? undefined;
      const { room, token } = await joinRoomFn({
        data: { code: trimmed, guest: player, token: existingToken },
      });
      setRoomToken(room.code, token);
      navigate({ to: "/game/$code", params: { code: room.code } });
    } catch (e) {
      setError(friendlyError(e, "Failed to join room"));
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md panel p-8 anim-rise">
        <div className="text-center mb-8">
          <div className="inline-block text-5xl mb-2" aria-hidden>
            🂡
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[color:var(--color-gold)]">
            Pishpirik
          </h1>
          <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
            The classic card game. Play 1v1 online.
          </p>
        </div>

        <label htmlFor="nickname" className="block text-sm font-medium mb-1">
          Your nickname
        </label>
        <input
          id="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Aidar"
          maxLength={20}
          className="w-full rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 mb-5 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
        />

        <button
          onClick={handleCreate}
          disabled={loading !== null}
          className="btn-primary btn-press w-full mb-3 hover:btn-primary-hover disabled:opacity-60"
        >
          {loading === "create" ? "Creating room…" : "Create room"}
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[color:var(--color-border)]" />
          <span className="text-xs uppercase tracking-widest text-[color:var(--color-muted-foreground)]">
            or
          </span>
          <div className="flex-1 h-px bg-[color:var(--color-border)]" />
        </div>

        <label htmlFor="room-code" className="block text-sm font-medium mb-1">
          Join with code
        </label>
        <div className="flex gap-2">
          <input
            id="room-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleJoin();
            }}
            placeholder="ABC234"
            maxLength={6}
            className="flex-1 min-w-0 rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 tracking-[0.3em] uppercase font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
          />
          <button
            onClick={handleJoin}
            disabled={loading !== null}
            className="btn-ghost btn-press hover:bg-[color:var(--color-secondary)] disabled:opacity-60"
          >
            {loading === "join" ? "Joining…" : "Join"}
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 text-sm text-[color:var(--color-destructive-foreground)] bg-[color:var(--color-destructive)] px-3 py-2 rounded-[var(--radius-md)] anim-rise"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
