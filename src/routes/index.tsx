import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createRoom, getLocalPlayer, joinRoom, setLocalPlayer } from "@/lib/game-client";

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
    setLocalPlayer({ ...p, name: name.trim() || "Player" });
    return { ...p, name: name.trim() || "Player" };
  };

  const handleCreate = async () => {
    setError(null);
    setLoading("create");
    try {
      const player = persistName();
      const room = await createRoom(player);
      navigate({ to: "/game/$code", params: { code: room.code } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create room");
      setLoading(null);
    }
  };

  const handleJoin = async () => {
    setError(null);
    if (!code.trim()) {
      setError("Enter a room code");
      return;
    }
    setLoading("join");
    try {
      const player = persistName();
      const room = await joinRoom(code.trim().toUpperCase(), player);
      navigate({ to: "/game/$code", params: { code: room.code } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join room");
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md panel p-8">
        <div className="text-center mb-8">
          <div className="inline-block text-5xl mb-2">🂡</div>
          <h1 className="text-4xl font-bold tracking-tight text-[color:var(--color-gold)]">
            Pishpirik
          </h1>
          <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
            The classic card game. Play 1v1 online.
          </p>
        </div>

        <label className="block text-sm font-medium mb-1">Your nickname</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Aidar"
          maxLength={20}
          className="w-full rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 mb-5 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
        />

        <button
          onClick={handleCreate}
          disabled={loading !== null}
          className="btn-primary w-full mb-3 hover:btn-primary-hover disabled:opacity-60"
        >
          {loading === "create" ? "Creating…" : "Create room"}
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[color:var(--color-border)]" />
          <span className="text-xs uppercase tracking-widest text-[color:var(--color-muted-foreground)]">
            or
          </span>
          <div className="flex-1 h-px bg-[color:var(--color-border)]" />
        </div>

        <label className="block text-sm font-medium mb-1">Join with code</label>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            maxLength={5}
            className="flex-1 rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 tracking-[0.3em] uppercase font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
          />
          <button
            onClick={handleJoin}
            disabled={loading !== null}
            className="btn-ghost hover:bg-[color:var(--color-secondary)] disabled:opacity-60"
          >
            {loading === "join" ? "…" : "Join"}
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-[color:var(--color-destructive-foreground)] bg-[color:var(--color-destructive)] px-3 py-2 rounded-[var(--radius-md)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
