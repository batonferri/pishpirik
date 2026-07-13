export type Suit = "S" | "H" | "D" | "C";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  s: Suit;
  r: Rank;
}

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  captured: Card[];
  pishtiPoints: number; // 10 per single-card capture, 20 for Jack-on-Jack
  /** Cards won through pishpirik captures (optional for states saved before this field existed). */
  pishtiCards?: Card[];
}

export interface GameState {
  deck: Card[];
  pile: Card[]; // top of pile = last element
  players: [PlayerState, PlayerState];
  turn: 0 | 1;
  lastCapturer: 0 | 1 | null;
  status: "waiting" | "playing" | "finished";
  winner: 0 | 1 | "tie" | null;
  scores?: { p0: number; p1: number; breakdown: ScoreBreakdown[] };
  lastAction?: {
    playerIdx: 0 | 1;
    card: Card;
    captured: boolean;
    pishti: boolean;
  } | null;
}

export interface ScoreBreakdown {
  playerIdx: 0 | 1;
  aces: number;
  jacks: number;
  twoOfClubs: number;
  tenOfDiamonds: number;
  queens: number;
  kings: number;
  tens: number;
  mostCards: number;
  pishti: number;
  total: number;
  cardCount: number;
}

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ s, r });
  return d;
}

export function shuffle<T>(arr: T[], seed?: number): T[] {
  const a = arr.slice();
  // simple LCG so games are reproducible if seed given, else Math.random
  let rand: () => number;
  if (typeof seed === "number") {
    let s = seed >>> 0;
    rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  } else {
    rand = Math.random;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardEq(a: Card, b: Card): boolean {
  return a.s === b.s && a.r === b.r;
}

export function newGame(
  p0: { id: string; name: string },
  p1: { id: string; name: string },
  startingTurn: 0 | 1 = 0,
): GameState {
  const deck = shuffle(freshDeck());
  const players: [PlayerState, PlayerState] = [
    {
      id: p0.id,
      name: p0.name,
      hand: deck.splice(0, 4),
      captured: [],
      pishtiPoints: 0,
      pishtiCards: [],
    },
    {
      id: p1.id,
      name: p1.name,
      hand: deck.splice(0, 4),
      captured: [],
      pishtiPoints: 0,
      pishtiCards: [],
    },
  ];
  const pile = deck.splice(0, 4);
  return {
    deck,
    pile,
    players,
    turn: startingTurn,
    lastCapturer: null,
    status: "playing",
    winner: null,
    lastAction: null,
  };
}

function dealMore(state: GameState) {
  if (state.deck.length === 0) return;
  for (const p of state.players) {
    const take = Math.min(4, state.deck.length);
    p.hand.push(...state.deck.splice(0, take));
  }
}

/** Apply a move; returns updated state (mutates a clone). */
export function playCard(state: GameState, playerIdx: 0 | 1, cardIdx: number): GameState {
  if (state.status !== "playing") throw new Error("Game not in progress");
  if (state.turn !== playerIdx) throw new Error("Not your turn");
  const s: GameState = JSON.parse(JSON.stringify(state));
  const me = s.players[playerIdx];
  if (cardIdx < 0 || cardIdx >= me.hand.length) throw new Error("Invalid card");
  const card = me.hand.splice(cardIdx, 1)[0];

  const top = s.pile[s.pile.length - 1];
  const isJack = card.r === "J";
  const matches = !!top && top.r === card.r;
  const captures = !!top && (isJack || matches);

  let pishti = false;
  if (captures) {
    // pishpirik: pile has exactly 1 card before this play
    if (s.pile.length === 1) {
      // Jack on Jack => 20 points
      if (isJack && top.r === "J") {
        me.pishtiPoints += 20;
        pishti = true;
      }
      // Same rank (except J on J which was already handled) => 10 points
      else if (matches) {
        me.pishtiPoints += 10;
        pishti = true;
      }
      if (pishti) {
        me.pishtiCards = [...(me.pishtiCards ?? []), top, card];
      }
    }

    s.pile.push(card);
    me.captured.push(...s.pile);
    s.pile = [];
    s.lastCapturer = playerIdx;
  } else {
    s.pile.push(card);
  }

  s.lastAction = { playerIdx, card, captured: captures, pishti };

  // pass turn
  s.turn = (playerIdx === 0 ? 1 : 0) as 0 | 1;

  // if both hands empty, deal more
  if (s.players[0].hand.length === 0 && s.players[1].hand.length === 0) {
    dealMore(s);
  }

  // end of match?
  const noCards =
    s.deck.length === 0 && s.players[0].hand.length === 0 && s.players[1].hand.length === 0;
  if (noCards) {
    if (s.pile.length > 0 && s.lastCapturer !== null) {
      s.players[s.lastCapturer].captured.push(...s.pile);
      s.pile = [];
    }
    finalize(s);
  }
  return s;
}

function finalize(s: GameState) {
  const breakdown: ScoreBreakdown[] = [0, 1].map((i) => {
    const idx = i as 0 | 1;
    const p = s.players[idx];
    let aces = 0,
      jacks = 0,
      queens = 0,
      kings = 0,
      tens = 0,
      twoC = 0,
      tenD = 0;
    for (const c of p.captured) {
      if (c.r === "A") aces++;
      if (c.r === "J") jacks++;
      if (c.r === "Q") queens++;
      if (c.r === "K") kings++;
      if (c.r === "10" && c.s !== "D") tens++;
      if (c.r === "2" && c.s === "C") twoC++;
      if (c.r === "10" && c.s === "D") tenD = 2;
    }
    return {
      playerIdx: idx,
      aces,
      jacks,
      queens,
      kings,
      tens,
      twoOfClubs: twoC,
      tenOfDiamonds: tenD,
      mostCards: 0,
      pishti: p.pishtiPoints,
      total: 0,
      cardCount: p.captured.length,
    };
  }) as ScoreBreakdown[];

  if (breakdown[0].cardCount > breakdown[1].cardCount) breakdown[0].mostCards = 3;
  else if (breakdown[1].cardCount > breakdown[0].cardCount) breakdown[1].mostCards = 3;

  for (const b of breakdown) {
    b.total =
      b.aces +
      b.jacks +
      b.queens +
      b.kings +
      b.tens +
      b.twoOfClubs +
      b.tenOfDiamonds +
      b.mostCards +
      b.pishti;
  }

  s.scores = { p0: breakdown[0].total, p1: breakdown[1].total, breakdown };
  s.status = "finished";
  if (breakdown[0].total > breakdown[1].total) s.winner = 0;
  else if (breakdown[1].total > breakdown[0].total) s.winner = 1;
  else s.winner = "tie";
}

export function cardLabel(c: Card): string {
  return `${c.r}${c.s}`;
}

/** Points a single captured card is worth at scoring time (0 for plain cards). */
export function cardPoints(c: Card): number {
  if (c.r === "10" && c.s === "D") return 2;
  if (c.r === "A" || c.r === "J" || c.r === "Q" || c.r === "K" || c.r === "10") return 1;
  if (c.r === "2" && c.s === "C") return 1;
  return 0;
}
