import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchRoom,
  getLocalPlayer,
  joinRoom,
  restartMatch,
  submitMove,
  type RoomRow,
} from "@/lib/game-client";
import { PlayingCard } from "@/components/PlayingCard";
import type { Card, GameState } from "@/lib/pishpirik";

export const Route = createFileRoute("/game/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Pishpirik room ${params.code}` },
      { name: "description", content: "Join this Pishpirik card game room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GameRoom,
});

function GameRoom() {
  const { code } = Route.useParams();
  const [player] = useState(() =>
    typeof window !== "undefined" ? getLocalPlayer() : { id: "", name: "" },
  );
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // initial load + auto-join
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let r = await fetchRoom(code);
        if (!r) {
          setError("Room not found");
          return;
        }
        // auto-join as guest if we have a name and there's an open seat
        const state = r.state;
        const isPlayer = state.host?.id === player.id || state.guest?.id === player.id;
        if (!isPlayer && r.status === "waiting" && player.name) {
          r = await joinRoom(code, player);
        }
        if (!cancelled) setRoom(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load room");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, player.id, player.name]);

  // realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`game:${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `code=eq.${code}` },
        (payload) => {
          const next = payload.new as unknown as RoomRow;
          if (next) setRoom(next);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [code]);

  if (error) {
    return (
      <Centered>
        <p className="text-lg mb-4">{error}</p>
        <Link to="/" className="btn-primary hover:btn-primary-hover">
          Back home
        </Link>
      </Centered>
    );
  }
  if (!room) return <Centered>Loading…</Centered>;

  const state = room.state;
  const isHost = state.host?.id === player.id;
  const isGuest = state.guest?.id === player.id;
  const iAmIn = isHost || isGuest;

  if (!iAmIn && !player.name) {
    return (
      <Centered>
        <p className="mb-4">
          You need a nickname to join room <b>{code}</b>.
        </p>
        <Link to="/" className="btn-primary hover:btn-primary-hover">
          Go set a nickname
        </Link>
      </Centered>
    );
  }

  if (room.status === "waiting" || !state.game) {
    return (
      <Centered>
        <div className="panel p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-2 text-[color:var(--color-gold)]">
            Waiting for opponent
          </h2>
          <p className="text-sm text-[color:var(--color-muted-foreground)] mb-6">
            Share this code with a friend:
          </p>
          <div className="text-5xl font-mono tracking-[0.4em] font-bold mb-2">{code}</div>
          <button
            onClick={() => {
              const url = `${window.location.origin}/game/${code}`;
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="btn-ghost text-sm hover:bg-[color:var(--color-secondary)]"
          >
            {copied ? "Link copied!" : "Copy invite link"}
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <Table
      room={room}
      game={state.game}
      playerIdx={isHost ? 0 : 1}
      onPlay={async (idx) => {
        try {
          await submitMove(room, player.id, idx);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Move failed");
          setTimeout(() => setError(null), 2500);
        }
      }}
      onRestart={async () => {
        try {
          await restartMatch(room);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Restart failed");
        }
      }}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 text-center">
      <div>{children}</div>
    </div>
  );
}

interface TableProps {
  room: RoomRow;
  game: GameState;
  playerIdx: 0 | 1;
  onPlay: (cardIdx: number) => void;
  onRestart: () => void;
}

function Table({ room, game, playerIdx, onPlay, onRestart }: TableProps) {
  const me = game.players[playerIdx];
  const opp = game.players[playerIdx === 0 ? 1 : 0];
  const myTurn = game.turn === playerIdx && game.status === "playing";
  const top = game.pile[game.pile.length - 1] as Card | undefined;
  const last = game.lastAction;

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-6 gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between panel px-4 py-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-[color:var(--color-muted-foreground)]">Room</span>
          <span className="font-mono tracking-widest text-[color:var(--color-gold)] font-bold">
            {room.code}
          </span>
        </div>
        <Link to="/" className="text-[color:var(--color-muted-foreground)] hover:underline">
          Leave
        </Link>
      </div>

      {/* Opponent */}
      <PlayerRow player={opp} isTurn={!myTurn && game.status === "playing"} opponent />

      {/* Center table */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-[color:var(--color-muted-foreground)] mb-1">
              Deck
            </div>
            {game.deck.length > 0 ? (
              <div className="relative">
                <PlayingCard faceDown />
                <span className="absolute -bottom-2 -right-2 text-xs bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)] rounded-full px-2 py-0.5 font-bold">
                  {game.deck.length}
                </span>
              </div>
            ) : (
              <div className="w-16 h-24 rounded-[var(--radius)] border-2 border-dashed border-[color:var(--color-border)]" />
            )}
          </div>

          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-[color:var(--color-muted-foreground)] mb-1">
              Pile ({game.pile.length})
            </div>
            <div className="relative w-24 h-32 flex items-center justify-center">
              {game.pile.length === 0 ? (
                <div className="w-16 h-24 rounded-[var(--radius)] border-2 border-dashed border-[color:var(--color-border)]" />
              ) : (
                game.pile.slice(-3).map((c, i, arr) => (
                  <div
                    key={i}
                    className="absolute"
                    style={{
                      transform: `translate(${(i - arr.length + 1) * 8}px, ${(i - arr.length + 1) * -4}px) rotate(${(i - arr.length + 1) * 4}deg)`,
                    }}
                  >
                    <PlayingCard card={c} />
                  </div>
                ))
              )}
            </div>
            {top && (
              <div className="text-xs mt-1 text-[color:var(--color-muted-foreground)]">
                Top: {top.r}
                {suitGlyph(top.s)}
              </div>
            )}
          </div>
        </div>

        {last && (
          <div className="text-sm text-[color:var(--color-muted-foreground)] h-5">
            {last.playerIdx === playerIdx ? "You" : opp.name} played{" "}
            <b className="text-[color:var(--color-foreground)]">
              {last.card.r}
              {suitGlyph(last.card.s)}
            </b>
            {last.captured && " — captured!"}
            {last.pishti && (
              <span className="text-[color:var(--color-gold)] font-bold"> PISHPIRIK!</span>
            )}
          </div>
        )}

        {game.status === "finished" && game.scores && (
          <FinalScore game={game} playerIdx={playerIdx} onRestart={onRestart} />
        )}
      </div>

      {/* My row */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold">{me.name} (you)</span>
            <span className="text-xs text-[color:var(--color-muted-foreground)]">
              Captured: {me.captured.length} · Pishpirik: {me.pishtiPoints}
            </span>
          </div>
          <div
            className={`text-sm font-semibold px-3 py-1 rounded-full ${
              myTurn
                ? "bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)] animate-pulse"
                : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
            }`}
          >
            {game.status === "finished" ? "Match over" : myTurn ? "Your turn" : "Waiting…"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-center min-h-[6rem]">
          {me.hand.length === 0 && (
            <span className="text-[color:var(--color-muted-foreground)] self-center">
              (no cards in hand)
            </span>
          )}
          {me.hand.map((c, i) => (
            <PlayingCard
              key={`${c.r}${c.s}-${i}`}
              card={c}
              size="lg"
              onClick={() => onPlay(i)}
              disabled={!myTurn}
              highlight={myTurn}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  isTurn,
  opponent,
}: {
  player: { name: string; hand: unknown[]; captured: unknown[]; pishtiPoints: number };
  isTurn: boolean;
  opponent?: boolean;
}) {
  return (
    <div className="panel p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{player.name}</span>
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          Captured: {player.captured.length} · Pishpirik: {player.pishtiPoints}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {Array.from({ length: player.hand.length }).map((_, i) => (
            <div key={i} className={opponent ? "card-back w-8 h-12" : "card-back w-8 h-12"} />
          ))}
        </div>
        {isTurn && (
          <span className="text-xs font-bold text-[color:var(--color-gold)] uppercase tracking-widest">
            Turn
          </span>
        )}
      </div>
    </div>
  );
}

function FinalScore({
  game,
  playerIdx,
  onRestart,
}: {
  game: GameState;
  playerIdx: 0 | 1;
  onRestart: () => void;
}) {
  const b = game.scores!.breakdown;
  const won = game.winner === "tie" ? "tie" : game.winner === playerIdx ? "won" : "lost";
  return (
    <div className="panel p-6 mt-2 max-w-lg w-full">
      <h2 className="text-2xl font-bold text-center mb-4 text-[color:var(--color-gold)]">
        {won === "won" ? "You won!" : won === "lost" ? "You lost" : "It's a tie"}
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[color:var(--color-muted-foreground)]">
            <th className="text-left"></th>
            <th>{game.players[0].name}</th>
            <th>{game.players[1].name}</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Aces" a={b[0].aces} bv={b[1].aces} />
          <Row label="Jacks" a={b[0].jacks} bv={b[1].jacks} />
          <Row label="2 of Clubs" a={b[0].twoOfClubs} bv={b[1].twoOfClubs} />
          <Row label="10 of Diamonds" a={b[0].tenOfDiamonds} bv={b[1].tenOfDiamonds} />
          <Row label="Queens" a={b[0].queens} bv={b[1].queens} />
          <Row label="Kings" a={b[0].kings} bv={b[1].kings} />
          <Row label="Tens" a={b[0].tens} bv={b[1].tens} />
          <Row label="Most cards (+3)" a={b[0].mostCards} bv={b[1].mostCards} />
          <Row label="Pishpirik bonuses" a={b[0].pishti} bv={b[1].pishti} />
          <tr className="font-bold border-t border-[color:var(--color-border)]">
            <td className="pt-2">Total</td>
            <td className="text-center pt-2">{b[0].total}</td>
            <td className="text-center pt-2">{b[1].total}</td>
          </tr>
        </tbody>
      </table>
      <button onClick={onRestart} className="btn-primary w-full mt-6 hover:btn-primary-hover">
        Rematch
      </button>
    </div>
  );
}

function Row({ label, a, bv }: { label: string; a: number; bv: number }) {
  return (
    <tr>
      <td className="py-1">{label}</td>
      <td className="text-center">{a}</td>
      <td className="text-center">{bv}</td>
    </tr>
  );
}

function suitGlyph(s: string) {
  return s === "S" ? "♠" : s === "H" ? "♥" : s === "D" ? "♦" : "♣";
}
