import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  clearRoomToken,
  errorCodeOf,
  friendlyError,
  getLocalPlayer,
  getRoomToken,
  setLocalPlayer,
  setRoomToken,
} from "@/lib/game-client";
import {
  claimAbandonedFn,
  fetchRoomFn,
  heartbeatFn,
  joinRoomFn,
  leaveRoomFn,
  myViewFn,
  rematchFn,
  submitMoveFn,
} from "@/lib/game.functions";
import {
  ABANDON_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  REMATCH_TIMEOUT_MS,
  type MyView,
  type PublicGameState,
  type PublicRoom,
} from "@/lib/room-engine";
import { PlayingCard } from "@/components/PlayingCard";
import { LanguageToggle } from "@/components/LanguageToggle";
import { translate, useI18n, type TranslationKey } from "@/lib/i18n";
import { cardEq, cardPoints, type Card } from "@/lib/pishpirik";
import { MessageCircle } from "lucide-react";

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

type ConnStatus = "connecting" | "online" | "reconnecting";

// ---------- chat ----------

const CHAT_PRESETS = [
  "chat.goodLuck",
  "chat.goodGame",
  "chat.thatWasLucky",
  "chat.niceMove",
  "chat.soClose",
  "chat.hurryUp",
] as const satisfies readonly TranslationKey[];
type ChatPreset = (typeof CHAT_PRESETS)[number];

const MAX_CHAT_LEN = 100;
const CHAT_BUBBLE_MS = 4500;
const CHAT_COOLDOWN_MS = 600;

/** Sent over the realtime channel. Presets travel as keys so each side sees its own language. */
interface ChatPayload {
  from: string;
  preset?: ChatPreset;
  text?: string;
}

interface ChatBubbleState {
  id: number;
  text: string;
}

function isChatPreset(v: unknown): v is ChatPreset {
  return typeof v === "string" && (CHAT_PRESETS as readonly string[]).includes(v);
}

function GameRoom() {
  const { code: rawCode } = Route.useParams();
  const code = rawCode.toUpperCase();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [player, setPlayer] = useState(() =>
    typeof window !== "undefined" ? getLocalPlayer() : { id: "", name: "" },
  );
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [view, setView] = useState<MyView | null>(null);
  const [seat, setSeat] = useState<0 | 1 | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [conn, setConn] = useState<ConnStatus>("connecting");
  const [presentIds, setPresentIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [pishtiFlash, setPishtiFlash] = useState<{ points: number; mine: boolean } | null>(null);
  const [starterBanner, setStarterBanner] = useState<string | null>(null);
  const [myBubble, setMyBubble] = useState<ChatBubbleState | null>(null);
  const [oppBubble, setOppBubble] = useState<ChatBubbleState | null>(null);

  const versionRef = useRef(-1);
  const tokenRef = useRef<string | null>(null);
  const seatRef = useRef<0 | 1 | null>(null);
  const viewRef = useRef<MyView | null>(null);
  const prevGameNoRef = useRef(0);
  const animatedVersionRef = useRef(-1);
  const oppOfflineSinceRef = useRef<number | null>(null);
  const claimingRef = useRef(false);
  const joiningRef = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const bubbleSeqRef = useRef(0);
  const bubbleTimersRef = useRef<{ mine: number; opp: number }>({ mine: 0, opp: 0 });
  const lastChatAtRef = useRef(0);

  seatRef.current = seat;
  viewRef.current = view;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const showBubble = useCallback((mine: boolean, text: string) => {
    const set = mine ? setMyBubble : setOppBubble;
    set({ id: ++bubbleSeqRef.current, text });
    const timers = bubbleTimersRef.current;
    const key = mine ? "mine" : "opp";
    window.clearTimeout(timers[key]);
    timers[key] = window.setTimeout(() => set(null), CHAT_BUBBLE_MS);
  }, []);

  const sendChat = useCallback(
    (msg: { text?: string; preset?: ChatPreset }) => {
      const channel = channelRef.current;
      if (!channel) return;
      const now = Date.now();
      if (now - lastChatAtRef.current < CHAT_COOLDOWN_MS) return;
      const text = msg.preset
        ? translate(msg.preset)
        : (msg.text ?? "").trim().slice(0, MAX_CHAT_LEN);
      if (!text) return;
      lastChatAtRef.current = now;
      const payload: ChatPayload = msg.preset
        ? { from: player.id, preset: msg.preset }
        : { from: player.id, text };
      channel.send({ type: "broadcast", event: "chat", payload }).catch(() => {});
      showBubble(true, text);
    },
    [player.id, showBubble],
  );

  /** Accept a room snapshot only if it is newer than what we already have. */
  const acceptRoom = useCallback((next: PublicRoom) => {
    if (next.version <= versionRef.current) return;
    versionRef.current = next.version;
    setRoom(next);

    const g = next.state.game;
    // New game (first deal or rematch): announce the starter.
    if (next.state.gameNo > prevGameNoRef.current && g && g.status === "playing") {
      prevGameNoRef.current = next.state.gameNo;
      const mySeat = seatRef.current;
      if (mySeat !== null && next.state.startingTurn !== null) {
        setStarterBanner(
          next.state.startingTurn === mySeat
            ? translate("youStart")
            : translate("oppStarts", { name: g.players[next.state.startingTurn].name }),
        );
        window.setTimeout(() => setStarterBanner(null), 2600);
      }
    }
    // Pishpirik celebration — animate each version at most once, so a
    // reconnect replaying the same state never re-triggers it.
    if (g?.lastAction?.pishti && next.version > animatedVersionRef.current) {
      const mySeat = seatRef.current;
      const points = g.lastAction.card.r === "J" ? 20 : 10;
      setPishtiFlash({ points, mine: mySeat !== null && g.lastAction.playerIdx === mySeat });
      window.setTimeout(() => setPishtiFlash(null), 1400);
    }
    animatedVersionRef.current = next.version;
  }, []);

  /** Full authoritative snapshot (used on load, reconnect, and after realtime pings). */
  const refreshView = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { room: r, view: v } = await myViewFn({ data: { code, token } });
      seatRef.current = v.playerIdx;
      acceptRoom(r);
      setView(v);
      setSeat(v.playerIdx);
    } catch (e) {
      if (errorCodeOf(e) === "NOT_A_ROOM_PLAYER") {
        clearRoomToken(code);
        tokenRef.current = null;
        seatRef.current = null;
        setSeat(null);
      } else if (errorCodeOf(e) === "ROOM_NOT_FOUND") {
        setFatal(friendlyError(e));
      }
    }
  }, [code, acceptRoom]);

  // ---------- initial load ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getRoomToken(code);
      tokenRef.current = token;
      try {
        if (token) {
          const { room: r, view: v } = await myViewFn({ data: { code, token } });
          if (cancelled) return;
          seatRef.current = v.playerIdx;
          acceptRoom(r);
          setView(v);
          setSeat(v.playerIdx);
          prevGameNoRef.current = r.state.gameNo;
          // Show the starter banner when arriving into a fresh, unplayed game.
          if (r.state.game && r.state.game.status === "playing" && !r.state.game.lastAction) {
            setStarterBanner(
              r.state.startingTurn === v.playerIdx
                ? translate("youStart")
                : translate("oppStarts", {
                    name: r.state.game.players[r.state.startingTurn ?? 0].name,
                  }),
            );
            window.setTimeout(() => setStarterBanner(null), 2600);
          }
          return;
        }
        const r = await fetchRoomFn({ data: { code } });
        if (cancelled) return;
        acceptRoom(r);
        prevGameNoRef.current = r.state.gameNo;
      } catch (e) {
        if (!cancelled) {
          if (errorCodeOf(e) === "NOT_A_ROOM_PLAYER") {
            clearRoomToken(code);
            tokenRef.current = null;
            try {
              const r = await fetchRoomFn({ data: { code } });
              if (!cancelled) acceptRoom(r);
            } catch (e2) {
              if (!cancelled) setFatal(friendlyError(e2, translate("failedLoadRoom")));
            }
          } else {
            setFatal(friendlyError(e, translate("failedLoadRoom")));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, acceptRoom]);

  // ---------- join ----------
  const join = useCallback(
    async (name: string) => {
      if (joiningRef.current) return;
      joiningRef.current = true;
      setPending(true);
      try {
        const p = { ...getLocalPlayer(), name: name.trim() || "Player" };
        setLocalPlayer(p);
        setPlayer(p);
        const {
          room: r,
          token,
          playerIdx,
        } = await joinRoomFn({
          data: { code, guest: p, token: getRoomToken(code) ?? undefined },
        });
        setRoomToken(code, token);
        tokenRef.current = token;
        seatRef.current = playerIdx;
        setSeat(playerIdx);
        acceptRoom(r);
        await refreshView();
      } catch (e) {
        showToast(friendlyError(e, translate("failedJoinRoom")));
      } finally {
        joiningRef.current = false;
        setPending(false);
      }
    },
    [code, acceptRoom, refreshView, showToast],
  );

  // Auto-join through an invite link when we already have a nickname.
  useEffect(() => {
    if (!room || seat !== null || tokenRef.current) return;
    if (room.status === "waiting" && !room.state.guest && player.name) {
      join(player.name);
    }
  }, [room, seat, player.name, join]);

  // ---------- realtime + presence ----------
  useEffect(() => {
    const channel = supabase.channel(`room:${code}`, {
      config: { presence: { key: player.id } },
    });
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "games", filter: `code=eq.${code}` },
      (payload) => {
        const next = payload.new as unknown as PublicRoom | undefined;
        if (!next || typeof next.version !== "number") return;
        if (next.version <= versionRef.current) return; // stale/duplicate event
        acceptRoom(next);
        // Hands are never broadcast; pull my hand when it may have changed.
        const v = viewRef.current;
        const g = next.state.game;
        const mySeat = seatRef.current;
        if (
          mySeat !== null &&
          g &&
          (!v || v.gameNo !== next.state.gameNo || g.players[mySeat].handCount !== v.hand.length)
        ) {
          refreshView();
        }
      },
    );
    channel.on("presence", { event: "sync" }, () => {
      setPresentIds(Object.keys(channel.presenceState()));
    });
    channel.on("broadcast", { event: "chat" }, ({ payload }) => {
      const msg = payload as Partial<ChatPayload> | undefined;
      if (!msg || msg.from === player.id) return;
      const text = isChatPreset(msg.preset)
        ? translate(msg.preset)
        : typeof msg.text === "string"
          ? msg.text.trim().slice(0, MAX_CHAT_LEN)
          : "";
      if (text) showBubble(false, text);
    });
    channelRef.current = channel;
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        setConn("online");
        await channel.track({ online_at: new Date().toISOString() });
        // After (re)connecting, never rely on missed events — take a snapshot.
        if (tokenRef.current) refreshView();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setConn("reconnecting");
      }
    });
    return () => {
      if (channelRef.current === channel) channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [code, player.id, acceptRoom, refreshView, showBubble]);

  // ---------- heartbeat ----------
  useEffect(() => {
    if (seat === null) return;
    const beat = () => {
      const token = tokenRef.current;
      if (token) heartbeatFn({ data: { code, token } }).catch(() => {});
    };
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        beat();
        refreshView();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [seat, code, refreshView]);

  // ---------- derived opponent presence ----------
  const game = room?.state.game;
  const oppInfo =
    seat !== null && room?.state.guest ? (seat === 0 ? room.state.guest : room.state.host) : null;
  const oppOnline = !!oppInfo && presentIds.includes(oppInfo.id);
  const playing = !!game && game.status === "playing";

  // Track how long the opponent has been gone (for the reconnect grace period).
  if (playing && oppInfo && !oppOnline) {
    if (oppOfflineSinceRef.current === null) oppOfflineSinceRef.current = Date.now();
  } else {
    oppOfflineSinceRef.current = null;
    claimingRef.current = false;
  }

  const rematch = room?.state.rematch;
  const needsTicker =
    (playing && !!oppInfo && !oppOnline) || (!!rematch && rematch.status === "requested");
  useEffect(() => {
    if (!needsTicker) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [needsTicker]);

  // Grace period over → ask the server to end the game (it re-validates).
  const oppGoneMs = oppOfflineSinceRef.current ? now - oppOfflineSinceRef.current : 0;
  useEffect(() => {
    if (!playing || oppOnline || oppGoneMs < ABANDON_GRACE_MS || claimingRef.current) return;
    const token = tokenRef.current;
    if (!token) return;
    claimingRef.current = true;
    claimAbandonedFn({ data: { code, token } })
      .then(({ room: r }) => acceptRoom(r))
      .catch(() => {
        // opponent still heartbeating (e.g. other tab) — retry on next tick window
        window.setTimeout(() => {
          claimingRef.current = false;
        }, 15_000);
      });
  }, [playing, oppOnline, oppGoneMs, code, acceptRoom]);

  // ---------- actions ----------
  const handlePlay = useCallback(
    async (card: Card) => {
      const token = tokenRef.current;
      if (!token || !viewRef.current || pending) return;
      setPending(true);
      try {
        const { room: r, view: v } = await submitMoveFn({
          data: { code, token, card, gameNo: viewRef.current.gameNo },
        });
        acceptRoom(r);
        setView(v);
      } catch (e) {
        showToast(friendlyError(e, translate("moveFailed")));
        refreshView();
      } finally {
        setPending(false);
      }
    },
    [code, pending, acceptRoom, refreshView, showToast],
  );

  const handleRematch = useCallback(
    async (action: "request" | "accept" | "decline") => {
      const token = tokenRef.current;
      if (!token || pending) return;
      setPending(true);
      try {
        const { room: r, view: v } = await rematchFn({ data: { code, token, action } });
        acceptRoom(r);
        if (v) setView(v);
      } catch (e) {
        showToast(friendlyError(e, translate("rematchFailed")));
        refreshView();
      } finally {
        setPending(false);
      }
    },
    [code, pending, acceptRoom, refreshView, showToast],
  );

  const handleLeave = useCallback(async () => {
    const token = tokenRef.current;
    if (token && playing) {
      const ok = window.confirm(translate("leaveForfeit"));
      if (!ok) return;
    }
    if (token) {
      try {
        await leaveRoomFn({ data: { code, token } });
      } catch {
        // leaving must always succeed locally
      }
      clearRoomToken(code);
    }
    navigate({ to: "/" });
  }, [code, playing, navigate]);

  // ---------- render ----------
  if (fatal) {
    return (
      <Centered>
        <div className="panel p-8 anim-rise">
          <p className="text-lg mb-4">{fatal}</p>
          <Link to="/" className="btn-primary btn-press hover:btn-primary-hover">
            {t("backHome")}
          </Link>
        </div>
      </Centered>
    );
  }
  if (!room) {
    return (
      <Centered>
        <div className="text-[color:var(--color-muted-foreground)] anim-blink">
          {t("connectingToRoom")}
        </div>
      </Centered>
    );
  }

  // Visitor (no seat in this room)
  if (seat === null) {
    if (room.status === "waiting" && !room.state.guest) {
      return (
        <JoinPrompt
          code={code}
          hostName={room.state.host.name}
          defaultName={player.name}
          pending={pending}
          onJoin={join}
        />
      );
    }
    return (
      <Centered>
        <div className="panel p-8 max-w-md anim-rise">
          <h2 className="text-xl font-bold mb-2">{t("roomFull")}</h2>
          <p className="text-sm text-[color:var(--color-muted-foreground)] mb-6">
            {t("roomFullDesc")}
          </p>
          <Link to="/" className="btn-primary btn-press hover:btn-primary-hover">
            {t("backHome")}
          </Link>
        </div>
      </Centered>
    );
  }

  if (room.status === "waiting" || !game || !view) {
    const meName = seat === 0 ? room.state.host.name : (room.state.guest?.name ?? player.name);
    const oppInLobby =
      seat !== null && room.state.guest
        ? seat === 0
          ? room.state.guest
          : room.state.host
        : null;
    return (
      <WaitingRoom
        code={code}
        conn={conn}
        onLeave={handleLeave}
        loadingHand={!view && !!game}
        meName={meName}
        opp={oppInLobby}
        oppOnline={!!oppInLobby && presentIds.includes(oppInLobby.id)}
        myBubble={myBubble}
        oppBubble={oppBubble}
        onChat={sendChat}
      />
    );
  }

  return (
    <Table
      code={code}
      conn={conn}
      game={game}
      view={view}
      seat={seat}
      gameNo={room.state.gameNo}
      rematch={room.state.rematch!}
      endReason={room.state.endReason}
      seriesWins={room.state.seriesWins ?? [0, 0]}
      startingTurn={room.state.startingTurn}
      oppOnline={oppOnline}
      oppGoneMs={oppGoneMs}
      pending={pending}
      toast={toast}
      pishtiFlash={pishtiFlash}
      starterBanner={starterBanner}
      now={now}
      myId={player.id}
      version={room.version}
      myBubble={myBubble}
      oppBubble={oppBubble}
      onPlay={handlePlay}
      onRematch={handleRematch}
      onLeave={handleLeave}
      onChat={sendChat}
    />
  );
}

// ---------- small screens ----------

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 text-center">
      <div>{children}</div>
    </div>
  );
}

function JoinPrompt({
  code,
  hostName,
  defaultName,
  pending,
  onJoin,
}: {
  code: string;
  hostName: string;
  defaultName: string;
  pending: boolean;
  onJoin: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(defaultName);
  return (
    <Centered>
      <div className="panel p-8 max-w-md w-full anim-rise">
        <h2 className="text-2xl font-bold mb-1 text-[color:var(--color-gold)]">
          {t("joinHostsGame", { host: hostName })}
        </h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)] mb-6">
          {t("room")} <span className="font-mono font-bold tracking-widest">{code}</span>
        </p>
        <label htmlFor="join-name" className="block text-left text-sm font-medium mb-1">
          {t("yourNickname")}
        </label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onJoin(name);
          }}
          placeholder={t("nicknamePlaceholder")}
          maxLength={20}
          className="w-full rounded-[var(--radius)] bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
        />
        <button
          onClick={() => onJoin(name)}
          disabled={pending || !name.trim()}
          className="btn-primary btn-press w-full hover:btn-primary-hover disabled:opacity-60"
        >
          {pending ? t("joining") : t("takeASeat")}
        </button>
      </div>
    </Centered>
  );
}

function WaitingRoom({
  code,
  conn,
  onLeave,
  loadingHand,
  meName,
  opp,
  oppOnline,
  myBubble,
  oppBubble,
  onChat,
}: {
  code: string;
  conn: ConnStatus;
  onLeave: () => void;
  loadingHand: boolean;
  meName: string;
  opp: { id: string; name: string } | null;
  oppOnline: boolean;
  myBubble: ChatBubbleState | null;
  oppBubble: ChatBubbleState | null;
  onChat: (msg: { text?: string; preset?: ChatPreset }) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Centered>
      <div className="fixed top-4 right-4 z-30">
        <LanguageToggle />
      </div>
      {opp && (
        <div className="fixed top-4 left-4 right-16 z-30 max-w-md mx-auto panel px-3 py-2 flex items-center justify-between gap-2 anim-rise">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative shrink-0">
              <Avatar name={opp.name} online={oppOnline} />
              {oppBubble && <ChatBubble key={oppBubble.id} text={oppBubble.text} below />}
            </span>
            <span className="font-semibold truncate text-sm">{opp.name}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative shrink-0">
              <Avatar name={meName} online />
              {myBubble && <ChatBubble key={myBubble.id} text={myBubble.text} />}
            </span>
            <ChatControl onChat={onChat} />
          </div>
        </div>
      )}
      <div className="panel p-8 text-center max-w-md w-full anim-rise">
        <h2 className="text-2xl font-bold mb-2 text-[color:var(--color-gold)]">
          {loadingHand ? t("dealingCards") : t("waitingForOpponent")}
        </h2>
        {!loadingHand && (
          <>
            <p className="text-sm text-[color:var(--color-muted-foreground)] mb-6">
              {t("shareCode")}
            </p>
            <div className="text-4xl sm:text-5xl font-mono tracking-[0.35em] font-bold mb-3 select-all">
              {code}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/game/${code}`);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
              className="btn-ghost btn-press text-sm hover:bg-[color:var(--color-secondary)]"
            >
              {copied ? t("linkCopied") : t("copyInviteLink")}
            </button>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
              <ConnDot conn={conn} />
              <span className="anim-blink">{t("waiting")}</span>
            </div>
          </>
        )}
        <button
          onClick={onLeave}
          className="mt-6 text-sm text-[color:var(--color-muted-foreground)] hover:underline"
        >
          {t("closeRoom")}
        </button>
      </div>
    </Centered>
  );
}

function ConnDot({ conn }: { conn: ConnStatus }) {
  const color =
    conn === "online"
      ? "bg-emerald-400"
      : conn === "reconnecting"
        ? "bg-amber-400 anim-blink"
        : "bg-zinc-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} aria-hidden />;
}

// ---------- main table ----------

interface TableProps {
  code: string;
  conn: ConnStatus;
  game: PublicGameState;
  view: MyView;
  seat: 0 | 1;
  gameNo: number;
  rematch: NonNullable<PublicRoom["state"]["rematch"]>;
  endReason: PublicRoom["state"]["endReason"];
  seriesWins: [number, number];
  startingTurn: 0 | 1 | null;
  oppOnline: boolean;
  oppGoneMs: number;
  pending: boolean;
  toast: string | null;
  pishtiFlash: { points: number; mine: boolean } | null;
  starterBanner: string | null;
  now: number;
  myId: string;
  version: number;
  myBubble: ChatBubbleState | null;
  oppBubble: ChatBubbleState | null;
  onPlay: (card: Card) => void;
  onRematch: (action: "request" | "accept" | "decline") => void;
  onLeave: () => void;
  onChat: (msg: { text?: string; preset?: ChatPreset }) => void;
}

function Table(props: TableProps) {
  const {
    code,
    conn,
    game,
    view,
    seat,
    gameNo,
    seriesWins,
    oppOnline,
    oppGoneMs,
    pending,
    toast,
    pishtiFlash,
    starterBanner,
    version,
    myBubble,
    oppBubble,
    onPlay,
    onLeave,
    onChat,
  } = props;
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const me = game.players[seat];
  const opp = game.players[seat === 0 ? 1 : 0];
  const myTurn = game.turn === seat && game.status === "playing";
  const last = game.lastAction;
  const finished = game.status === "finished";
  const oppDisconnected = !finished && !oppOnline;
  const graceLeft = Math.max(0, Math.ceil((ABANDON_GRACE_MS - oppGoneMs) / 1000));

  // Hold the end-game modal back briefly so the final play (and a possible
  // pishpirik flash) stays visible. If we arrive into an already-finished
  // game (reconnect) or it ended by forfeit, show it right away.
  const [showEndModal, setShowEndModal] = useState(finished);
  useEffect(() => {
    if (!finished) {
      setShowEndModal(false);
      return;
    }
    if (props.endReason !== "score") {
      setShowEndModal(true);
      return;
    }
    const timer = window.setTimeout(() => setShowEndModal(true), 1000);
    return () => window.clearTimeout(timer);
  }, [finished, props.endReason]);

  return (
    <div className="min-h-screen flex flex-col p-3 sm:p-4 md:p-6 gap-3 md:gap-4 max-w-5xl mx-auto w-full">
      {/* Top bar */}
      <div className="flex items-center justify-between panel px-3 sm:px-4 py-2 text-sm gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-[color:var(--color-muted-foreground)] hidden sm:inline">
            {t("room")}
          </span>
          <span className="font-mono tracking-widest text-[color:var(--color-gold)] font-bold">
            {code}
          </span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/game/${code}`);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }}
            className="text-xs text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] btn-press border border-[color:var(--color-border)] rounded-full px-2.5 py-1"
          >
            {copied ? t("copied") : t("copyInvite")}
          </button>
          <SeriesBadge wins={seriesWins} seat={seat} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)]">
            <ConnDot conn={conn} />
            <span className="hidden sm:inline">
              {conn === "online"
                ? t("connected")
                : conn === "reconnecting"
                  ? t("reconnecting")
                  : "…"}
            </span>
          </span>
          <LanguageToggle />
          <button
            onClick={onLeave}
            className="text-[color:var(--color-muted-foreground)] hover:underline"
          >
            {t("leave")}
          </button>
        </div>
      </div>

      {/* Status banners */}
      {conn === "reconnecting" && <Banner tone="warn">{t("connectionLost")}</Banner>}
      {oppDisconnected && (
        <Banner tone="warn">{t("oppDisconnected", { name: opp.name, s: graceLeft })}</Banner>
      )}

      {/* Opponent */}
      <PlayerPanel
        name={opp.name}
        capturedCount={opp.capturedCount}
        pishtiPoints={opp.pishtiPoints}
        handCount={opp.handCount}
        isTurn={!finished && game.turn !== seat}
        online={oppOnline}
        opponent
        gameNo={gameNo}
        bubble={oppBubble}
      />

      {/* Center table */}
      <div className="relative flex-1 flex flex-col items-center justify-center gap-3 md:gap-4 py-2">
        <div className="flex items-center gap-5 sm:gap-8">
          <div className="text-center">
            <div className="text-[10px] sm:text-xs uppercase tracking-widest text-[color:var(--color-muted-foreground)] mb-1">
              {t("deck")}
            </div>
            {game.deckCount > 0 ? (
              <div className="relative">
                <PlayingCard faceDown />
                <span className="absolute -bottom-2 -right-2 text-xs bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)] rounded-full px-2 py-0.5 font-bold">
                  {game.deckCount}
                </span>
              </div>
            ) : (
              <EmptySlot />
            )}
          </div>

          <div className="text-center">
            <div className="text-[10px] sm:text-xs uppercase tracking-widest text-[color:var(--color-muted-foreground)] mb-1">
              {t("pileCount", { n: game.pile.length })}
            </div>
            <div className="relative w-24 h-24 sm:h-32 flex items-center justify-center">
              {game.pile.length === 0 ? (
                <EmptySlot />
              ) : (
                game.pile.slice(-3).map((c, i, arr) => {
                  const isTop = i === arr.length - 1;
                  return (
                    <div
                      key={`${c.r}${c.s}`}
                      className={`absolute ${isTop ? "anim-play" : ""}`}
                      style={{
                        transform: `translate(${(i - arr.length + 1) * 8}px, ${(i - arr.length + 1) * -4}px) rotate(${(i - arr.length + 1) * 4}deg)`,
                      }}
                    >
                      <PlayingCard card={c} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Last action line */}
        <div className="text-sm text-[color:var(--color-muted-foreground)] h-6 text-center">
          {last && (
            <span key={`la-${version}`} className="anim-rise inline-block">
              {last.playerIdx === seat ? t("youPlayed") : t("oppPlayed", { name: opp.name })}{" "}
              <b className="text-[color:var(--color-foreground)]">
                {last.card.r}
                {suitGlyph(last.card.s)}
              </b>
              {last.captured && (
                <span className="text-[color:var(--color-gold)] font-semibold anim-pop inline-block ml-1">
                  {t("capturedPile")}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Turn chip */}
        {!finished && (
          <div
            className={`text-sm font-semibold px-4 py-1.5 rounded-full transition-colors duration-300 ${
              myTurn
                ? "bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)]"
                : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
            }`}
          >
            {myTurn ? t("yourTurn") : t("oppTurn", { name: opp.name })}
          </div>
        )}

        {/* Starter banner */}
        {starterBanner && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="anim-rise bg-[color:var(--color-popover)] border border-[color:var(--color-gold)] rounded-full px-6 py-2.5 font-bold text-[color:var(--color-gold)] shadow-lg">
              {starterBanner}
            </div>
          </div>
        )}

        {/* Pishpirik celebration */}
        {pishtiFlash && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="anim-pishti text-center">
              <div className="text-4xl sm:text-6xl font-black text-[color:var(--color-gold)] drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
                PISHPIRIK!
              </div>
              <div className="text-xl sm:text-2xl font-bold mt-1">
                {pishtiFlash.mine ? "+" : `${opp.name} +`}
                {pishtiFlash.points} {t("points")}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* My hand */}
      <div
        className={`panel p-3 sm:p-4 transition-shadow duration-300 ${myTurn ? "turn-glow" : ""}`}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="relative shrink-0">
              <Avatar name={me.name} online />
              {myBubble && <ChatBubble key={myBubble.id} text={myBubble.text} />}
            </span>
            <span className="font-semibold truncate">{me.name}</span>
            <ScoreChips capturedCount={me.capturedCount} pishtiPoints={me.pishtiPoints} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ChatControl onChat={onChat} />
            <div
              className={`text-xs sm:text-sm font-semibold px-3 py-1 rounded-full shrink-0 ${
                finished
                  ? "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
                  : myTurn
                    ? "bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)]"
                    : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
              }`}
            >
              {finished
                ? t("gameOver")
                : myTurn
                  ? pending
                    ? t("playingNow")
                    : t("yourTurn")
                  : t("waiting")}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-center min-h-[6rem]">
          {view.hand.length === 0 && (
            <span className="text-[color:var(--color-muted-foreground)] self-center text-sm">
              {t("noCardsInHand")}
            </span>
          )}
          {view.hand.map((c, i) => (
            <PlayingCard
              key={`${gameNo}-${c.r}${c.s}`}
              card={c}
              size="lg"
              onClick={() => onPlay(c)}
              disabled={!myTurn || pending}
              className="anim-deal"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </div>

      {/* Error toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 anim-rise">
          <div className="bg-[color:var(--color-destructive)] text-[color:var(--color-destructive-foreground)] text-sm font-medium px-4 py-2.5 rounded-[var(--radius)] shadow-lg">
            {toast}
          </div>
        </div>
      )}

      {/* End-game modal */}
      {finished && showEndModal && <EndModal {...props} />}
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="w-14 h-20 sm:w-16 sm:h-24 rounded-[var(--radius)] border-2 border-dashed border-[color:var(--color-border)]" />
  );
}

function Avatar({ name, online }: { name: string; online: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="relative shrink-0">
      <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[color:var(--color-secondary)] border border-[color:var(--color-border)] flex items-center justify-center text-xs font-bold">
        {initials || "?"}
      </span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[color:var(--color-popover)] ${
          online ? "bg-emerald-400" : "bg-zinc-500"
        }`}
        aria-label={online ? "online" : "offline"}
      />
    </span>
  );
}

/** Speech bubble anchored to an avatar. Points down at the avatar by default; `below` flips it. */
function ChatBubble({ text, below }: { text: string; below?: boolean }) {
  return (
    <span
      className={`absolute left-1/2 z-30 pointer-events-none anim-bubble ${
        below ? "top-full mt-2.5" : "bottom-full mb-2.5"
      }`}
    >
      <span
        className={`relative block -translate-x-4 w-max max-w-[min(240px,60vw)] bg-[color:var(--color-card)] text-[color:var(--color-card-foreground)] text-sm font-medium px-3 py-1.5 rounded-xl shadow-lg break-words ${
          below ? "rounded-tl-sm" : "rounded-bl-sm"
        }`}
      >
        {text}
        <span
          className={`absolute left-2.5 w-2.5 h-2.5 bg-[color:var(--color-card)] rotate-45 ${
            below ? "-top-1" : "-bottom-1"
          }`}
          aria-hidden
        />
      </span>
    </span>
  );
}

function ChatControl({ onChat }: { onChat: TableProps["onChat"] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submitText = () => {
    if (!text.trim()) return;
    onChat({ text });
    setText("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("chat")}
        aria-expanded={open}
        className={`btn-press rounded-full border border-[color:var(--color-border)] p-1.5 sm:p-2 transition-colors ${
          open
            ? "bg-[color:var(--color-secondary)] text-[color:var(--color-foreground)]"
            : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-secondary)]"
        }`}
      >
        <MessageCircle className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-40 panel p-3 w-72 anim-rise">
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {CHAT_PRESETS.map((key) => (
              <button
                key={key}
                onClick={() => {
                  onChat({ preset: key });
                  setOpen(false);
                }}
                className="btn-press text-xs border border-[color:var(--color-border)] rounded-full px-2.5 py-1 hover:bg-[color:var(--color-secondary)] transition-colors"
              >
                {t(key)}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitText();
              }}
              placeholder={t("chatPlaceholder")}
              maxLength={MAX_CHAT_LEN}
              className="flex-1 min-w-0 rounded-full bg-[color:var(--color-input)] border border-[color:var(--color-border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)]"
            />
            <button
              onClick={submitText}
              disabled={!text.trim()}
              className="btn-press text-sm font-semibold rounded-full px-3 py-1.5 bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] disabled:opacity-50"
            >
              {t("send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreChips({
  capturedCount,
  pishtiPoints,
}: {
  capturedCount: number;
  pishtiPoints: number;
}) {
  const { t } = useI18n();
  return (
    <span className="text-xs text-[color:var(--color-muted-foreground)] whitespace-nowrap">
      <span key={`c-${capturedCount}`} className="anim-pop inline-block">
        {capturedCount}
      </span>{" "}
      {t("capturedChip")}
      {pishtiPoints > 0 && (
        <>
          {" · "}
          <span
            key={`p-${pishtiPoints}`}
            className="anim-pop inline-block text-[color:var(--color-gold)] font-semibold"
          >
            +{pishtiPoints} pishpirik
          </span>
        </>
      )}
    </span>
  );
}

/** Series win count from the viewer's perspective: myWins–oppWins. */
function SeriesBadge({ wins, seat }: { wins: [number, number]; seat: 0 | 1 }) {
  const { t } = useI18n();
  const mine = wins[seat];
  const theirs = wins[seat === 0 ? 1 : 0];
  return (
    <span
      className="text-xs sm:text-sm font-semibold tabular-nums whitespace-nowrap px-2.5 py-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50"
      title={t("series")}
    >
      <span className="text-[color:var(--color-muted-foreground)] font-medium mr-1.5 hidden sm:inline">
        {t("series")}
      </span>
      <span key={`s-${mine}-${theirs}`} className="anim-pop inline-block text-[color:var(--color-gold)]">
        {t("seriesScore", { a: mine, b: theirs })}
      </span>
    </span>
  );
}

function PlayerPanel({
  name,
  capturedCount,
  pishtiPoints,
  handCount,
  isTurn,
  online,
  gameNo,
  bubble,
}: {
  name: string;
  capturedCount: number;
  pishtiPoints: number;
  handCount: number;
  isTurn: boolean;
  online: boolean;
  opponent?: boolean;
  gameNo: number;
  bubble?: ChatBubbleState | null;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`panel p-3 flex items-center justify-between gap-2 transition-shadow duration-300 ${
        isTurn ? "turn-glow" : ""
      }`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <span className="relative shrink-0">
          <Avatar name={name} online={online} />
          {bubble && <ChatBubble key={bubble.id} text={bubble.text} below />}
        </span>
        <div className="min-w-0">
          <div className="font-semibold truncate flex items-center gap-2">
            {name}
            {!online && (
              <span className="text-[10px] uppercase tracking-wide text-amber-400 anim-blink">
                {t("offline")}
              </span>
            )}
          </div>
          <ScoreChips capturedCount={capturedCount} pishtiPoints={pishtiPoints} />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex gap-1">
          {Array.from({ length: handCount }).map((_, i) => (
            <div
              key={`${gameNo}-${i}`}
              className="card-back w-6 h-9 sm:w-8 sm:h-12 anim-deal"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
        {isTurn && (
          <span className="text-xs font-bold text-[color:var(--color-gold)] uppercase tracking-widest anim-rise">
            {t("turn")}
          </span>
        )}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <div
      className={`anim-rise text-sm font-medium px-4 py-2 rounded-[var(--radius)] text-center ${
        tone === "warn"
          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
          : "bg-[color:var(--color-secondary)] text-[color:var(--color-secondary-foreground)]"
      }`}
    >
      {children}
    </div>
  );
}

// ---------- end-game modal ----------

function EndModal(props: TableProps) {
  const { game, seat, rematch, endReason, seriesWins, myId, now, pending, onRematch, onLeave } =
    props;
  const { t } = useI18n();
  const opp = game.players[seat === 0 ? 1 : 0];
  const won = game.winner === "tie" ? "tie" : game.winner === seat ? "won" : "lost";
  const byForfeit = endReason === "forfeit" || endReason === "abandoned";
  const b = game.scores?.breakdown;
  const [showDetails, setShowDetails] = useState(false);
  const mySeries = seriesWins[seat];
  const oppSeries = seriesWins[seat === 0 ? 1 : 0];

  const iRequested = rematch.status === "requested" && rematch.requestedBy === myId;
  const oppRequested = rematch.status === "requested" && rematch.requestedBy !== myId;
  const expiresIn =
    rematch.status === "requested" && rematch.requestedAt !== null
      ? Math.max(0, Math.ceil((REMATCH_TIMEOUT_MS - (now - rematch.requestedAt)) / 1000))
      : null;
  const requestExpired = expiresIn === 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="panel p-5 sm:p-6 max-w-lg w-full anim-modal max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-1 text-[color:var(--color-gold)]">
          {won === "won" ? t("youWon") : won === "lost" ? t("youLost") : t("itsATie")}
        </h2>
        <p className="text-center text-sm text-[color:var(--color-muted-foreground)] mb-1">
          {t("series")}{" "}
          <span
            key={`series-${mySeries}-${oppSeries}`}
            className="anim-pop inline-block font-bold tabular-nums text-[color:var(--color-gold)]"
          >
            {t("seriesScore", { a: mySeries, b: oppSeries })}
          </span>
        </p>
        {byForfeit && (
          <p className="text-center text-sm text-[color:var(--color-muted-foreground)] mb-3">
            {endReason === "abandoned"
              ? t("oppNoReconnect", { name: opp.name })
              : won === "won"
                ? t("oppLeftGame", { name: opp.name })
                : t("youLeftGame")}
          </p>
        )}

        {b && (
          <div className="my-4">
            {/* Big totals */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {([0, 1] as const).map((idx) => (
                <div
                  key={idx}
                  className={`rounded-[var(--radius)] border px-3 py-3 text-center ${
                    idx === 1 ? "order-3" : ""
                  } ${
                    game.winner === idx
                      ? "border-[color:var(--color-gold)] bg-[color:var(--color-gold)]/10"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/40"
                  }`}
                >
                  <div
                    className={`text-xs font-semibold truncate mb-1 ${
                      idx === seat
                        ? "text-[color:var(--color-gold)]"
                        : "text-[color:var(--color-muted-foreground)]"
                    }`}
                  >
                    {game.players[idx].name}
                  </div>
                  <div className="text-3xl sm:text-4xl font-black tabular-nums leading-none">
                    {b[idx].total}
                  </div>
                </div>
              ))}
              <div className="order-2 text-sm font-bold text-[color:var(--color-muted-foreground)]">
                :
              </div>
            </div>

            {/* Collapsible breakdown */}
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="mt-2 w-full text-center text-xs font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] btn-press py-1.5"
            >
              {showDetails ? t("hideDetails") : t("showDetails")}{" "}
              <span
                className={`inline-block transition-transform duration-200 ${showDetails ? "rotate-180" : ""}`}
                aria-hidden
              >
                ▾
              </span>
            </button>
            {showDetails && (
              <table className="w-full text-sm mt-1 anim-rise">
                <thead>
                  <tr className="text-[color:var(--color-muted-foreground)]">
                    <th className="text-left font-medium pb-1">{t("scoring")}</th>
                    <th className={`pb-1 ${seat === 0 ? "text-[color:var(--color-gold)]" : ""}`}>
                      {game.players[0].name}
                    </th>
                    <th className={`pb-1 ${seat === 1 ? "text-[color:var(--color-gold)]" : ""}`}>
                      {game.players[1].name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ScoreRow label={t("aces")} a={b[0].aces} bv={b[1].aces} />
                  <ScoreRow label={t("jacks")} a={b[0].jacks} bv={b[1].jacks} />
                  <ScoreRow label={t("twoOfClubs")} a={b[0].twoOfClubs} bv={b[1].twoOfClubs} />
                  <ScoreRow
                    label={t("tenOfDiamonds")}
                    a={b[0].tenOfDiamonds}
                    bv={b[1].tenOfDiamonds}
                  />
                  <ScoreRow label={t("queens")} a={b[0].queens} bv={b[1].queens} />
                  <ScoreRow label={t("kings")} a={b[0].kings} bv={b[1].kings} />
                  <ScoreRow label={t("tens")} a={b[0].tens} bv={b[1].tens} />
                  <ScoreRow label={t("mostCards")} a={b[0].mostCards} bv={b[1].mostCards} />
                  <ScoreRow label={t("pishtiBonuses")} a={b[0].pishti} bv={b[1].pishti} />
                </tbody>
              </table>
            )}
          </div>
        )}

        <CapturedCardsSection game={game} seat={seat} />

        {/* Rematch area */}
        <div className="mt-4 space-y-2">
          {byForfeit ? (
            <p className="text-center text-sm text-[color:var(--color-muted-foreground)]">
              {t("rematchUnavailable")}
            </p>
          ) : iRequested && !requestExpired ? (
            <div className="text-center">
              <div className="btn-ghost w-full opacity-80 cursor-default">
                {t("waitingForName", { name: opp.name })}{" "}
                <span className="anim-blink inline-block">●</span>
              </div>
              {expiresIn !== null && (
                <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1.5">
                  {t("requestExpires", { s: expiresIn })}
                </p>
              )}
            </div>
          ) : oppRequested && !requestExpired ? (
            <div className="anim-rise">
              <p className="text-center text-sm font-semibold mb-2">
                {t("wantsRematch", { name: opp.name })}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onRematch("accept")}
                  disabled={pending}
                  className="btn-primary btn-press flex-1 hover:btn-primary-hover disabled:opacity-60"
                >
                  {t("accept")}
                </button>
                <button
                  onClick={() => onRematch("decline")}
                  disabled={pending}
                  className="btn-ghost btn-press flex-1 hover:bg-[color:var(--color-secondary)] disabled:opacity-60"
                >
                  {t("decline")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {rematch.status === "declined" && (
                <p className="text-center text-sm text-[color:var(--color-muted-foreground)] anim-rise">
                  {rematch.declinedBy === myId
                    ? t("youDeclinedRematch")
                    : t("oppDeclinedRematch", { name: opp.name })}
                </p>
              )}
              {requestExpired && (
                <p className="text-center text-sm text-[color:var(--color-muted-foreground)]">
                  {t("rematchExpired")}
                </p>
              )}
              <button
                onClick={() => onRematch("request")}
                disabled={pending}
                className="btn-primary btn-press w-full hover:btn-primary-hover disabled:opacity-60"
              >
                {pending ? t("sending") : t("playAgain")}
              </button>
            </>
          )}
          <button
            onClick={onLeave}
            className="btn-ghost btn-press w-full hover:bg-[color:var(--color-secondary)]"
          >
            {t("leaveRoom")}
          </button>
        </div>
      </div>
    </div>
  );
}

const POINT_GLOW = "ring-2 ring-sky-400 shadow-[0_0_10px_2px_rgba(56,189,248,0.55)]";
const PISHTI_GLOW =
  "ring-2 ring-[color:var(--color-gold)] shadow-[0_0_12px_2px_rgba(230,190,90,0.6)]";

/** Everyone's captured cards, revealed at game end. Point cards glow blue, pishpirik wins glow gold. */
function CapturedCardsSection({ game, seat }: { game: PublicGameState; seat: 0 | 1 }) {
  const { t } = useI18n();
  if (!game.players.some((p) => p.captured?.length)) return null;

  const hasPoints = game.players.some((p) => p.captured?.some((c) => cardPoints(c) > 0));
  const hasPishti = game.players.some((p) => p.pishtiCards?.length);

  return (
    <div className="my-4">
      <h3 className="text-sm font-medium text-[color:var(--color-muted-foreground)] mb-2">
        {t("capturedCards")}
      </h3>
      {(hasPoints || hasPishti) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--color-muted-foreground)] mb-3">
          {hasPoints && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              {t("legendPointCards")}
            </span>
          )}
          {hasPishti && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--color-gold)] shadow-[0_0_6px_rgba(230,190,90,0.8)]" />
              {t("legendPishtiCards")}
            </span>
          )}
        </div>
      )}
      <div className="space-y-4">
        {([seat, seat === 0 ? 1 : 0] as const).map((idx) => (
          <PlayerCapturedCards key={idx} player={game.players[idx]} highlighted={idx === seat} />
        ))}
      </div>
    </div>
  );
}

function PlayerCapturedCards({
  player,
  highlighted,
}: {
  player: PublicGameState["players"][0];
  highlighted: boolean;
}) {
  const { t } = useI18n();
  const captured = player.captured ?? [];
  const pishtiCards = player.pishtiCards ?? [];
  const isPishti = (c: Card) => pishtiCards.some((p) => cardEq(p, c));

  // Gold (pishpirik) first, then blue (point cards), then the rest.
  const sorted = captured.slice().sort((a, b) => {
    const rank = (c: Card) => (isPishti(c) ? 0 : cardPoints(c) > 0 ? 1 : 2);
    return rank(a) - rank(b);
  });

  return (
    <div>
      <div className="text-sm font-semibold mb-1.5 flex items-center gap-2">
        <span className={highlighted ? "text-[color:var(--color-gold)]" : ""}>{player.name}</span>
        <span className="text-xs font-normal text-[color:var(--color-muted-foreground)]">
          {captured.length} {t("capturedChip")}
        </span>
      </div>
      {captured.length === 0 ? (
        <p className="text-xs text-[color:var(--color-muted-foreground)]">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 p-0.5">
          {sorted.map((c) => (
            <PlayingCard
              key={`${c.r}${c.s}`}
              card={c}
              size="xs"
              className={isPishti(c) ? PISHTI_GLOW : cardPoints(c) > 0 ? POINT_GLOW : "opacity-75"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreRow({ label, a, bv }: { label: string; a: number; bv: number }) {
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
