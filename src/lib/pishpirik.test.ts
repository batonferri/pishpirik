import { describe, expect, test } from "bun:test";
import { freshDeck, newGame, playCard, shuffle, type Card, type GameState } from "./pishpirik";

const P0 = { id: "p0", name: "Alice" };
const P1 = { id: "p1", name: "Bob" };

/** Build a deterministic in-progress state for rule tests. */
function makeState(overrides: Partial<GameState>): GameState {
  const base = newGame(P0, P1, 0);
  return { ...base, ...overrides };
}

describe("deck and dealing", () => {
  test("a fresh deck has 52 unique cards", () => {
    const d = freshDeck();
    expect(d.length).toBe(52);
    expect(new Set(d.map((c) => `${c.r}${c.s}`)).size).toBe(52);
  });

  test("shuffle preserves the multiset of cards", () => {
    const d = shuffle(freshDeck(), 42);
    expect(d.length).toBe(52);
    expect(new Set(d.map((c) => `${c.r}${c.s}`)).size).toBe(52);
  });

  test("newGame deals 4/4/4 and honors the starting turn", () => {
    const g0 = newGame(P0, P1, 0);
    expect(g0.turn).toBe(0);
    const g1 = newGame(P0, P1, 1);
    expect(g1.turn).toBe(1);
    expect(g1.players[0].hand.length).toBe(4);
    expect(g1.players[1].hand.length).toBe(4);
    expect(g1.pile.length).toBe(4);
    expect(g1.deck.length).toBe(52 - 12);
  });
});

describe("capturing rules", () => {
  test("matching rank captures the pile", () => {
    const state = makeState({
      pile: [
        { r: "3", s: "H" },
        { r: "7", s: "C" },
      ],
      players: [
        { id: "p0", name: "Alice", hand: [{ r: "7", s: "S" }], captured: [], pishtiPoints: 0 },
        { id: "p1", name: "Bob", hand: [{ r: "2", s: "D" }], captured: [], pishtiPoints: 0 },
      ],
      turn: 0,
    });
    const next = playCard(state, 0, 0);
    expect(next.players[0].captured.length).toBe(3);
    expect(next.pile.length).toBe(0);
    expect(next.lastCapturer).toBe(0);
    expect(next.lastAction!.captured).toBe(true);
    expect(next.lastAction!.pishti).toBe(false); // pile had 2 cards — not a pishpirik
  });

  test("a Jack captures any non-empty pile", () => {
    const state = makeState({
      pile: [
        { r: "3", s: "H" },
        { r: "9", s: "C" },
        { r: "K", s: "D" },
      ],
      players: [
        { id: "p0", name: "Alice", hand: [{ r: "J", s: "S" }], captured: [], pishtiPoints: 0 },
        { id: "p1", name: "Bob", hand: [{ r: "2", s: "D" }], captured: [], pishtiPoints: 0 },
      ],
      turn: 0,
    });
    const next = playCard(state, 0, 0);
    expect(next.players[0].captured.length).toBe(4);
    expect(next.lastAction!.pishti).toBe(false);
  });

  test("non-matching card lands on the pile", () => {
    const state = makeState({
      pile: [{ r: "3", s: "H" }],
      players: [
        { id: "p0", name: "Alice", hand: [{ r: "5", s: "S" }], captured: [], pishtiPoints: 0 },
        { id: "p1", name: "Bob", hand: [{ r: "2", s: "D" }], captured: [], pishtiPoints: 0 },
      ],
      turn: 0,
    });
    const next = playCard(state, 0, 0);
    expect(next.pile.length).toBe(2);
    expect(next.players[0].captured.length).toBe(0);
    expect(next.turn).toBe(1);
  });
});

describe("pishpirik scoring", () => {
  test("capturing a single-card pile scores +10", () => {
    const state = makeState({
      pile: [{ r: "8", s: "H" }],
      players: [
        { id: "p0", name: "Alice", hand: [{ r: "8", s: "S" }], captured: [], pishtiPoints: 0 },
        { id: "p1", name: "Bob", hand: [{ r: "2", s: "D" }], captured: [], pishtiPoints: 0 },
      ],
      turn: 0,
    });
    const next = playCard(state, 0, 0);
    expect(next.players[0].pishtiPoints).toBe(10);
    expect(next.lastAction!.pishti).toBe(true);
  });

  test("Jack on a single Jack scores +20", () => {
    const state = makeState({
      pile: [{ r: "J", s: "H" }],
      players: [
        { id: "p0", name: "Alice", hand: [{ r: "J", s: "S" }], captured: [], pishtiPoints: 0 },
        { id: "p1", name: "Bob", hand: [{ r: "2", s: "D" }], captured: [], pishtiPoints: 0 },
      ],
      turn: 0,
    });
    const next = playCard(state, 0, 0);
    expect(next.players[0].pishtiPoints).toBe(20);
    expect(next.lastAction!.pishti).toBe(true);
  });

  test("Jack capturing a single non-Jack card is not a pishpirik... unless ranks match", () => {
    const state = makeState({
      pile: [{ r: "4", s: "H" }],
      players: [
        { id: "p0", name: "Alice", hand: [{ r: "J", s: "S" }], captured: [], pishtiPoints: 0 },
        { id: "p1", name: "Bob", hand: [{ r: "2", s: "D" }], captured: [], pishtiPoints: 0 },
      ],
      turn: 0,
    });
    const next = playCard(state, 0, 0);
    expect(next.players[0].pishtiPoints).toBe(0);
    expect(next.lastAction!.captured).toBe(true);
    expect(next.lastAction!.pishti).toBe(false);
  });
});

describe("full game", () => {
  test("playing all cards finishes the match with consistent scores", () => {
    let state = newGame(P0, P1, 0);
    let guard = 0;
    while (state.status === "playing" && guard++ < 200) {
      state = playCard(state, state.turn, 0);
    }
    expect(state.status).toBe("finished");
    expect(state.scores).toBeDefined();
    expect(state.deck.length).toBe(0);
    expect(state.pile.length).toBe(0);
    // every card ends up captured by someone
    const total = state.players[0].captured.length + state.players[1].captured.length;
    expect(total).toBe(52);
    // winner matches the totals
    const { p0, p1 } = state.scores!;
    if (p0 > p1) expect(state.winner).toBe(0);
    else if (p1 > p0) expect(state.winner).toBe(1);
    else expect(state.winner).toBe("tie");
  });

  test("guarding: cannot play out of turn or after the end", () => {
    const state = newGame(P0, P1, 0);
    expect(() => playCard(state, 1, 0)).toThrow("Not your turn");
    const done = { ...state, status: "finished" as const };
    expect(() => playCard(done, 0, 0)).toThrow("Game not in progress");
  });

  test("invalid card index is rejected", () => {
    const state = newGame(P0, P1, 0);
    expect(() => playCard(state, 0, 7)).toThrow("Invalid card");
    expect(() => playCard(state, 0, -1)).toThrow("Invalid card");
  });
});

describe("scoring details", () => {
  test("finalize counts point cards and most-cards bonus", () => {
    // Construct an end-of-game position: one card left each, empty deck.
    const capturedP0: Card[] = [
      { r: "A", s: "S" },
      { r: "A", s: "H" },
      { r: "2", s: "C" },
      { r: "10", s: "D" },
      { r: "5", s: "H" },
      { r: "6", s: "H" },
      { r: "7", s: "H" },
    ];
    const capturedP1: Card[] = [
      { r: "J", s: "D" },
      { r: "3", s: "C" },
    ];
    const state = makeState({
      deck: [],
      pile: [],
      players: [
        {
          id: "p0",
          name: "Alice",
          hand: [{ r: "9", s: "S" }],
          captured: capturedP0,
          pishtiPoints: 10,
        },
        {
          id: "p1",
          name: "Bob",
          hand: [{ r: "4", s: "D" }],
          captured: capturedP1,
          pishtiPoints: 0,
        },
      ],
      turn: 0,
      lastCapturer: 0,
    });
    let next = playCard(state, 0, 0);
    next = playCard(next, 1, 0);
    expect(next.status).toBe("finished");
    const b = next.scores!.breakdown;
    expect(b[0].aces).toBe(2);
    expect(b[0].twoOfClubs).toBe(1);
    expect(b[0].tenOfDiamonds).toBe(2);
    expect(b[0].pishti).toBe(10);
    expect(b[0].mostCards).toBe(3);
    expect(b[1].jacks).toBe(1);
    expect(next.winner).toBe(0);
  });
});
