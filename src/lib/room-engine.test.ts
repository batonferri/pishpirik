import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createPrivateRoom,
  expireRematch,
  forfeitGame,
  GameError,
  identify,
  rematchAction,
  REMATCH_TIMEOUT_MS,
  seatGuest,
  startNextGame,
  toMyView,
  toPublicState,
  type PrivateRoomState,
} from "./room-engine";
import type { Card } from "./pishpirik";

const HOST = { id: "host-id", name: "Alice" };
const GUEST = { id: "guest-id", name: "Bob" };
const HOST_TOKEN = "host-token";
const GUEST_TOKEN = "guest-token";

function freshRoom(): PrivateRoomState {
  return createPrivateRoom(HOST, HOST_TOKEN);
}

function seatedRoom(rand: () => number = () => 0.1): PrivateRoomState {
  return seatGuest(freshRoom(), GUEST, GUEST_TOKEN, rand);
}

/** Fast-forward a room to a finished-by-score game for rematch tests. */
function finishedRoom(startingTurn: 0 | 1 = 0): PrivateRoomState {
  const priv = seatedRoom(startingTurn === 0 ? () => 0.1 : () => 0.9);
  return {
    ...priv,
    endReason: "score",
    game: {
      ...priv.game!,
      status: "finished",
      winner: 0,
      scores: { p0: 5, p1: 3, breakdown: [] as never },
    },
  };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`expected ${code} but nothing was thrown`);
  } catch (e) {
    expect(e).toBeInstanceOf(GameError);
    expect((e as GameError).code).toBe(code);
  }
}

describe("room creation and joining", () => {
  test("1. creating a room produces a waiting room owned by the host", () => {
    const priv = freshRoom();
    expect(priv.host).toEqual(HOST);
    expect(priv.guest).toBeUndefined();
    expect(priv.game).toBeUndefined();
    expect(priv.gameNo).toBe(0);
  });

  test("2. second player joins successfully and the game starts", () => {
    const priv = seatedRoom();
    expect(priv.guest).toEqual(GUEST);
    expect(priv.game).toBeDefined();
    expect(priv.game!.status).toBe("playing");
    expect(priv.gameNo).toBe(1);
    expect(priv.game!.players[0].hand.length).toBe(4);
    expect(priv.game!.players[1].hand.length).toBe(4);
    expect(priv.game!.pile.length).toBe(4);
  });

  test("3. a third player is rejected once the room is full", () => {
    const priv = seatedRoom();
    expectCode(
      () => seatGuest(priv, { id: "intruder", name: "Mallory" }, "mallory-token"),
      "GAME_ALREADY_STARTED",
    );
  });

  test("3b. a second guest is rejected even before the game starts", () => {
    const priv = { ...seatedRoom(), game: undefined };
    expectCode(() => seatGuest(priv, { id: "intruder", name: "Mallory" }, "t"), "ROOM_FULL");
  });

  test("host cannot occupy the guest seat from a second tab", () => {
    const priv = freshRoom();
    expectCode(() => seatGuest(priv, HOST, "another-token"), "ALREADY_IN_ROOM");
  });
});

describe("identity and seat security", () => {
  test("4. a disconnected player reclaims their seat with their token", () => {
    const priv = seatedRoom();
    expect(identify(priv, HOST_TOKEN)).toBe(0);
    expect(identify(priv, GUEST_TOKEN)).toBe(1);
  });

  test("5. another user cannot steal a seat without the token", () => {
    const priv = seatedRoom();
    expectCode(() => identify(priv, "stolen-or-guessed"), "NOT_A_ROOM_PLAYER");
    expectCode(() => identify(priv, ""), "NOT_A_ROOM_PLAYER");
  });

  test("6. a player cannot act in a room they do not belong to", () => {
    const roomA = seatedRoom();
    // token from a different room is meaningless here
    expectCode(() => identify(roomA, "token-from-room-B"), "NOT_A_ROOM_PLAYER");
  });

  test("17. public state never exposes hands, deck order, or tokens", () => {
    const priv = seatedRoom();
    const pub = toPublicState(priv);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(HOST_TOKEN);
    expect(json).not.toContain(GUEST_TOKEN);
    expect(pub.game).toBeDefined();
    expect((pub.game as unknown as Record<string, unknown>).deck).toBeUndefined();
    for (const p of pub.game!.players) {
      expect((p as unknown as Record<string, unknown>).hand).toBeUndefined();
      expect(p.handCount).toBe(4);
    }
    // none of the hidden hand cards may appear in the public payload
    for (const c of priv.game!.players[0].hand) {
      expect(pub.game!.pile.some((pc) => pc.r === c.r && pc.s === c.s)).toBe(false);
    }
  });

  test("16. both clients derive the identical public state", () => {
    const priv = seatedRoom();
    expect(toPublicState(priv)).toEqual(toPublicState(priv));
  });

  test("18. reconnection view returns the player's own current hand", () => {
    const priv = seatedRoom();
    const v0 = toMyView(priv, 0);
    expect(v0.hand).toEqual(priv.game!.players[0].hand);
    expect(v0.playerIdx).toBe(0);
    expect(v0.gameNo).toBe(1);
    const v1 = toMyView(priv, 1);
    expect(v1.hand).toEqual(priv.game!.players[1].hand);
  });
});

describe("move validation", () => {
  test("7. a player cannot play during the opponent's turn", () => {
    const priv = seatedRoom(() => 0.1); // starter = 0
    const card = priv.game!.players[1].hand[0];
    expectCode(() => applyMove(priv, 1, card, priv.gameNo), "NOT_YOUR_TURN");
  });

  test("8. a player cannot play a card they do not own", () => {
    const priv = seatedRoom(() => 0.1);
    const oppCard = priv.game!.players[1].hand.find(
      (c) => !priv.game!.players[0].hand.some((m) => m.r === c.r && m.s === c.s),
    ) as Card;
    expectCode(() => applyMove(priv, 0, oppCard, priv.gameNo), "INVALID_CARD");
  });

  test("9. duplicate play events do not produce duplicate moves", () => {
    const priv = seatedRoom(() => 0.1);
    const card = priv.game!.players[0].hand[0];
    const next = applyMove(priv, 0, card, priv.gameNo);
    expect(next.game!.turn).toBe(1);
    // Replaying the exact same event must fail — turn passed and card is gone.
    expectCode(() => applyMove(next, 0, card, next.gameNo), "NOT_YOUR_TURN");
  });

  test("19. events from a previous game are ignored", () => {
    const priv = finishedRoom();
    const rematched = startNextGame(priv);
    const card = rematched.game!.players[rematched.game!.turn].hand[0];
    expectCode(() => applyMove(rematched, rematched.game!.turn, card, priv.gameNo), "STALE_EVENT");
  });

  test("playing after the game ended is rejected", () => {
    const priv = finishedRoom();
    const card: Card = { r: "A", s: "S" };
    expectCode(() => applyMove(priv, 0, card, priv.gameNo), "GAME_FINISHED");
  });

  test("a valid move advances the turn and moves the card to the pile or captures", () => {
    const priv = seatedRoom(() => 0.1);
    const card = priv.game!.players[0].hand[0];
    const next = applyMove(priv, 0, card, priv.gameNo);
    expect(next.game!.players[0].hand.length).toBe(3);
    expect(next.game!.turn).toBe(1);
    expect(next.game!.lastAction!.card).toEqual(card);
  });
});

describe("rematch flow", () => {
  test("10. one player requesting a rematch does not restart the game", () => {
    const priv = finishedRoom();
    const { priv: after, started } = rematchAction(priv, 0, "request", 1000);
    expect(started).toBe(false);
    expect(after.gameNo).toBe(priv.gameNo);
    expect(after.game!.status).toBe("finished");
    expect(after.rematch.status).toBe("requested");
    expect(after.rematch.requestedBy).toBe(HOST.id);
    expect(after.rematch.votes[HOST.id]).toBe(true);
  });

  test("duplicate request clicks do not double-vote or reset anything", () => {
    const priv = finishedRoom();
    const a = rematchAction(priv, 0, "request", 1000);
    const b = rematchAction(a.priv, 0, "request", 1500);
    expect(b.started).toBe(false);
    expect(b.priv).toEqual(a.priv);
  });

  test("11. both players accepting starts exactly one rematch", () => {
    const priv = finishedRoom(0);
    const a = rematchAction(priv, 0, "request", 1000);
    const b = rematchAction(a.priv, 1, "accept", 2000);
    expect(b.started).toBe(true);
    expect(b.priv.gameNo).toBe(priv.gameNo + 1);
    expect(b.priv.game!.status).toBe("playing");
    expect(b.priv.rematch.status).toBe("idle"); // votes cleared for the new game
    // a further accept cannot start a second rematch — the game is running again
    expectCode(() => rematchAction(b.priv, 0, "accept", 2100), "REMATCH_NOT_AVAILABLE");
  });

  test("12. declining cancels the rematch and informs both players", () => {
    const priv = finishedRoom();
    const a = rematchAction(priv, 0, "request", 1000);
    const b = rematchAction(a.priv, 1, "decline", 2000);
    expect(b.started).toBe(false);
    expect(b.priv.rematch.status).toBe("declined");
    expect(b.priv.rematch.declinedBy).toBe(GUEST.id);
    expect(b.priv.game!.status).toBe("finished"); // game untouched
    expect(b.priv.rematch.votes).toEqual({});
  });

  test("13. a rematch request expires after the timeout", () => {
    const priv = finishedRoom();
    const a = rematchAction(priv, 0, "request", 1000);
    const expired = expireRematch(a.priv, 1000 + REMATCH_TIMEOUT_MS + 1);
    expect(expired.rematch.status).toBe("idle");
    expect(expired.rematch.votes).toEqual({});
    // accepting an expired request is rejected
    expectCode(
      () => rematchAction(a.priv, 1, "accept", 1000 + REMATCH_TIMEOUT_MS + 1),
      "REMATCH_NOT_AVAILABLE",
    );
  });

  test("declining with no pending request is rejected", () => {
    const priv = finishedRoom();
    expectCode(() => rematchAction(priv, 1, "decline", 1000), "REMATCH_NOT_AVAILABLE");
  });

  test("rematch is not available while a game is still running", () => {
    const priv = seatedRoom();
    expectCode(() => rematchAction(priv, 0, "request", 1000), "REMATCH_NOT_AVAILABLE");
  });

  test("rematch is not available after a forfeit/abandon", () => {
    const priv = forfeitGame(seatedRoom(), 0, "forfeit");
    expectCode(() => rematchAction(priv, 0, "request", 1000), "REMATCH_NOT_AVAILABLE");
  });
});

describe("starting player fairness", () => {
  test("14. the first starter is chosen randomly on the server", () => {
    expect(seatedRoom(() => 0.1).startingTurn).toBe(0);
    expect(seatedRoom(() => 0.9).startingTurn).toBe(1);
    expect(seatedRoom(() => 0.1).game!.turn).toBe(0);
    expect(seatedRoom(() => 0.9).game!.turn).toBe(1);
  });

  test("15. the starter alternates on every rematch", () => {
    let priv = finishedRoom(0);
    priv = startNextGame(priv);
    expect(priv.startingTurn).toBe(1);
    expect(priv.game!.turn).toBe(1);

    priv = {
      ...priv,
      endReason: "score",
      game: { ...priv.game!, status: "finished", winner: 1 },
    };
    priv = startNextGame(priv);
    expect(priv.startingTurn).toBe(0);
    expect(priv.game!.turn).toBe(0);
  });

  test("a rematch fully resets the round state", () => {
    const priv = finishedRoom(0);
    const next = startNextGame(priv);
    expect(next.game!.players[0].hand.length).toBe(4);
    expect(next.game!.players[1].hand.length).toBe(4);
    expect(next.game!.players[0].captured.length).toBe(0);
    expect(next.game!.players[0].pishtiPoints).toBe(0);
    expect(next.game!.pile.length).toBe(4);
    expect(next.game!.deck.length).toBe(52 - 8 - 4);
    expect(next.game!.lastCapturer).toBeNull();
    expect(next.rematch.status).toBe("idle");
    expect(next.endReason).toBeNull();
  });
});

describe("forfeit and abandonment", () => {
  test("forfeiting ends the game in favor of the remaining player", () => {
    const priv = seatedRoom();
    const after = forfeitGame(priv, 1, "forfeit");
    expect(after.game!.status).toBe("finished");
    expect(after.game!.winner).toBe(1);
    expect(after.endReason).toBe("forfeit");
  });

  test("a finished game cannot be forfeited again", () => {
    const priv = finishedRoom();
    expectCode(() => forfeitGame(priv, 0, "abandoned"), "GAME_FINISHED");
  });
});
