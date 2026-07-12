import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  friendlyError,
  getLocalPlayer,
  getRoomToken,
  setLocalPlayer,
  setRoomToken,
} from "@/lib/game-client";
import { createRoomFn, joinRoomFn, listPublicRoomsFn } from "@/lib/game.functions";

export const Route = createFileRoute("/")({
  component: Home,
});

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinPrompt, setJoinPrompt] = useState<{ code: string; hostName: string } | null>(null);

  useEffect(() => {
    const p = getLocalPlayer();
    if (p.name) setName(p.name);
  }, []);

  const publicRooms = useQuery({
    queryKey: ["public-rooms"],
    queryFn: () => listPublicRoomsFn(),
    refetchInterval: 10_000,
  });

  const persistName = (nickname?: string) => {
    const p = getLocalPlayer();
    const next = { ...p, name: (nickname ?? name).trim() || "Player" };
    setLocalPlayer(next);
    setName(next.name);
    return next;
  };

  const handleCreate = async () => {
    setError(null);
    setLoading("create");
    try {
      const player = persistName();
      const { room, token } = await createRoomFn({ data: { host: player, isPublic } });
      setRoomToken(room.code, token);
      navigate({ to: "/game/$code", params: { code: room.code } });
    } catch (e) {
      setError(friendlyError(e, "Failed to create room"));
      setLoading(null);
    }
  };

  const handleJoin = async (joinCode: string, nickname?: string) => {
    setError(null);
    const trimmed = joinCode.trim().toUpperCase();
    if (!trimmed) {
      setError("Enter a room code");
      return;
    }
    setLoading("join");
    try {
      const player = persistName(nickname);
      const existingToken = getRoomToken(trimmed) ?? undefined;
      const { room, token } = await joinRoomFn({
        data: { code: trimmed, guest: player, token: existingToken },
      });
      setRoomToken(room.code, token);
      navigate({ to: "/game/$code", params: { code: room.code } });
    } catch (e) {
      setError(friendlyError(e, "Failed to join room"));
      setLoading(null);
      setJoinPrompt(null);
      publicRooms.refetch();
    }
  };

  const rooms = publicRooms.data?.rooms ?? [];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl flex flex-col lg:flex-row lg:items-start items-center justify-center gap-6">
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

          <span className="block text-sm font-medium mb-1">Room visibility</span>
          <div
            role="radiogroup"
            aria-label="Room visibility"
            className="grid grid-cols-2 gap-2 mb-5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!isPublic}
              onClick={() => setIsPublic(false)}
              className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors ${
                !isPublic
                  ? "border-[color:var(--color-gold)] bg-[color:var(--color-secondary)]"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-input)] opacity-70 hover:opacity-100"
              }`}
            >
              <span className="block text-sm font-semibold">Private</span>
              <span className="block text-xs text-[color:var(--color-muted-foreground)]">
                Invite with code only
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isPublic}
              onClick={() => setIsPublic(true)}
              className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors ${
                isPublic
                  ? "border-[color:var(--color-gold)] bg-[color:var(--color-secondary)]"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-input)] opacity-70 hover:opacity-100"
              }`}
            >
              <span className="block text-sm font-semibold">Public</span>
              <span className="block text-xs text-[color:var(--color-muted-foreground)]">
                Anyone can join from the lobby
              </span>
            </button>
          </div>

          <button
            onClick={handleCreate}
            disabled={loading !== null}
            className="btn-primary btn-press w-full mb-3 hover:btn-primary-hover disabled:opacity-60"
          >
            {loading === "create"
              ? "Creating room…"
              : `Create ${isPublic ? "public" : "private"} room`}
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
                if (e.key === "Enter") handleJoin(code);
              }}
              placeholder="ABC234"
              maxLength={6}
              className="flex-1 min-w-0 rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 tracking-[0.3em] uppercase font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
            />
            <button
              onClick={() => handleJoin(code)}
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

        <div className="w-full max-w-md lg:max-w-sm panel p-6 anim-rise">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[color:var(--color-gold)]">Public rooms</h2>
            <button
              onClick={() => publicRooms.refetch()}
              disabled={publicRooms.isFetching}
              aria-label="Refresh public rooms"
              className="btn-ghost btn-press text-xs px-2.5 py-1.5 hover:bg-[color:var(--color-secondary)] disabled:opacity-60"
            >
              {publicRooms.isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {rooms.length === 0 ? (
            <p className="text-sm text-[color:var(--color-muted-foreground)] py-6 text-center">
              {publicRooms.isPending
                ? "Loading rooms…"
                : "No open public rooms right now. Create one!"}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                  <th className="pb-2 font-medium">Code</th>
                  <th className="pb-2 font-medium">Host</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.code} className="border-t border-[color:var(--color-border)]">
                    <td className="py-2.5 font-mono tracking-widest">{r.code}</td>
                    <td className="py-2.5 max-w-[8rem] truncate" title={r.hostName}>
                      {r.hostName}
                    </td>
                    <td className="py-2.5 text-[color:var(--color-muted-foreground)] whitespace-nowrap">
                      {timeAgo(r.createdAt)}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => setJoinPrompt({ code: r.code, hostName: r.hostName })}
                        disabled={loading !== null}
                        className="btn-ghost btn-press text-xs px-3 py-1.5 hover:bg-[color:var(--color-secondary)] disabled:opacity-60"
                      >
                        Join
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {joinPrompt && (
        <JoinNamePrompt
          code={joinPrompt.code}
          hostName={joinPrompt.hostName}
          defaultName={name}
          pending={loading === "join"}
          onJoin={(nickname) => handleJoin(joinPrompt.code, nickname)}
          onCancel={() => setJoinPrompt(null)}
        />
      )}
    </div>
  );
}

function JoinNamePrompt({
  code,
  hostName,
  defaultName,
  pending,
  onJoin,
  onCancel,
}: {
  code: string;
  hostName: string;
  defaultName: string;
  pending: boolean;
  onJoin: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-prompt-title"
        className="panel p-8 max-w-md w-full anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="join-prompt-title"
          className="text-2xl font-bold mb-1 text-[color:var(--color-gold)]"
        >
          Join {hostName}&apos;s game
        </h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)] mb-6">
          Room <span className="font-mono font-bold tracking-widest">{code}</span>
        </p>
        <label htmlFor="join-name" className="block text-left text-sm font-medium mb-1">
          Your nickname
        </label>
        <input
          id="join-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && !pending) onJoin(name);
            if (e.key === "Escape" && !pending) onCancel();
          }}
          placeholder="e.g. Aidar"
          maxLength={20}
          className="w-full rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
        />
        <button
          onClick={() => onJoin(name)}
          disabled={pending || !name.trim()}
          className="btn-primary btn-press w-full mb-2 hover:btn-primary-hover disabled:opacity-60"
        >
          {pending ? "Joining…" : "Take a seat"}
        </button>
        <button
          onClick={onCancel}
          disabled={pending}
          className="btn-ghost btn-press w-full hover:bg-[color:var(--color-secondary)] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
