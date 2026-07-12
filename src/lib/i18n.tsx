// Lightweight i18n: English + Albanian dictionaries, a React context for
// reactive translations, and a module-level `translate` for non-component
// code (error mappers, event callbacks).
//
// Language resolution order: saved preference (localStorage) → browser
// language (sq* → Albanian) → timezone (Europe/Tirane → Albanian) → English.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "sq";

const LANG_KEY = "pishpirik.lang";

const en = {
  // Home / lobby
  tagline: "The classic card game. Play 1v1 online.",
  yourNickname: "Your nickname",
  nicknamePlaceholder: "e.g. Aidar",
  roomVisibility: "Room visibility",
  privateLabel: "Private",
  privateDesc: "Invite with code only",
  publicLabel: "Public",
  publicDesc: "Anyone can join from the lobby",
  creatingRoom: "Creating room…",
  createPublicRoom: "Create public room",
  createPrivateRoom: "Create private room",
  or: "or",
  joinWithCode: "Join with code",
  join: "Join",
  joining: "Joining…",
  enterRoomCode: "Enter a room code",
  publicRooms: "Public rooms",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  refreshPublicRooms: "Refresh public rooms",
  loadingRooms: "Loading rooms…",
  noPublicRooms: "No open public rooms right now. Create one!",
  codeCol: "Code",
  hostCol: "Host",
  createdCol: "Created",
  justNow: "just now",
  minutesAgo: "{m}min ago",
  hoursAgo: "{h}h ago",
  joinHostsGame: "Join {host}'s game",
  room: "Room",
  takeASeat: "Take a seat",
  cancel: "Cancel",

  // Game room
  youStart: "You start!",
  oppStarts: "{name} starts",
  leaveForfeit: "Leaving now forfeits the game. Leave anyway?",
  backHome: "Back home",
  connectingToRoom: "Connecting to room…",
  roomFull: "Room is full",
  roomFullDesc: "This room already has two players. Ask your friend for a new room code.",
  dealingCards: "Dealing cards…",
  waitingForOpponent: "Waiting for opponent",
  shareCode: "Share this code with a friend:",
  linkCopied: "Link copied!",
  copyInviteLink: "Copy invite link",
  waiting: "Waiting…",
  closeRoom: "Close room",
  copied: "Copied!",
  copyInvite: "Copy invite",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  leave: "Leave",
  connectionLost: "Connection lost — reconnecting…",
  oppDisconnected: "{name} disconnected — waiting for them to reconnect ({s}s)",
  deck: "Deck",
  pileCount: "Pile ({n})",
  youPlayed: "You played",
  oppPlayed: "{name} played",
  capturedPile: "captured the pile!",
  yourTurn: "Your turn",
  oppTurn: "{name}'s turn",
  points: "points",
  gameOver: "Game over",
  playingNow: "Playing…",
  noCardsInHand: "(no cards in hand)",
  capturedChip: "captured",
  offline: "offline",
  turn: "Turn",

  // End-game modal
  youWon: "You won!",
  youLost: "You lost",
  itsATie: "It's a tie",
  oppNoReconnect: "{name} didn't reconnect in time.",
  oppLeftGame: "{name} left the game.",
  youLeftGame: "You left the game.",
  scoring: "Scoring",
  aces: "Aces",
  jacks: "Jacks",
  twoOfClubs: "2 of Clubs",
  tenOfDiamonds: "10 of Diamonds",
  queens: "Queens",
  kings: "Kings",
  tens: "Tens",
  mostCards: "Most cards (+3)",
  pishtiBonuses: "Pishpirik bonuses",
  total: "Total",
  rematchUnavailable: "Rematch isn't available — your opponent left.",
  waitingForName: "Waiting for {name}…",
  requestExpires: "Request expires in {s}s",
  wantsRematch: "{name} wants a rematch!",
  accept: "Accept",
  decline: "Decline",
  youDeclinedRematch: "You declined the rematch.",
  oppDeclinedRematch: "{name} declined the rematch.",
  rematchExpired: "The rematch request expired.",
  sending: "Sending…",
  playAgain: "Play again",
  leaveRoom: "Leave room",

  // 404 / error pages
  pageNotFound: "Page not found",
  pageNotFoundDesc: "The page you're looking for doesn't exist or has been moved.",
  goHome: "Go home",
  pageDidntLoad: "This page didn't load",
  pageDidntLoadDesc: "Something went wrong on our end. You can try refreshing or head back home.",
  tryAgain: "Try again",

  // Errors
  somethingWentWrong: "Something went wrong",
  failedCreateRoom: "Failed to create room",
  failedJoinRoom: "Failed to join room",
  failedLoadRoom: "Failed to load room",
  moveFailed: "Move failed",
  rematchFailed: "Rematch failed",
  "error.ROOM_NOT_FOUND": "That room doesn't exist (or it expired).",
  "error.ROOM_FULL": "This room already has two players.",
  "error.NOT_A_ROOM_PLAYER": "You are not a player in this room.",
  "error.ALREADY_IN_ROOM": "You are already in this room — open your original tab or rejoin.",
  "error.NOT_YOUR_TURN": "It's not your turn yet.",
  "error.INVALID_CARD": "You can't play that card.",
  "error.GAME_ALREADY_STARTED": "This game has already started.",
  "error.GAME_NOT_STARTED": "The game hasn't started yet.",
  "error.GAME_FINISHED": "The game is already over.",
  "error.REMATCH_NOT_AVAILABLE": "A rematch isn't available right now.",
  "error.STALE_EVENT": "That action was out of date — the game has moved on.",
  "error.OPPONENT_STILL_CONNECTED": "Your opponent is still connected.",
  "error.VERSION_CONFLICT": "The game updated at the same time — please try again.",
  "error.INVALID_ACTION": "That action isn't possible right now.",

  language: "Language",
};

export type TranslationKey = keyof typeof en;

const sq: Record<TranslationKey, string> = {
  // Home / lobby
  tagline: "Loja klasike me letra. Luaje 1v1 online.",
  yourNickname: "Nofka jote",
  nicknamePlaceholder: "p.sh. Ardi",
  roomVisibility: "Dukshmëria e dhomës",
  privateLabel: "Private",
  privateDesc: "Ftesë vetëm me kod",
  publicLabel: "Publike",
  publicDesc: "Kushdo mund të bashkohet nga lobi",
  creatingRoom: "Duke krijuar dhomën…",
  createPublicRoom: "Krijo dhomë publike",
  createPrivateRoom: "Krijo dhomë private",
  or: "ose",
  joinWithCode: "Bashkohu me kod",
  join: "Bashkohu",
  joining: "Duke u bashkuar…",
  enterRoomCode: "Shkruaj kodin e dhomës",
  publicRooms: "Dhomat publike",
  refresh: "Rifresko",
  refreshing: "Duke rifreskuar…",
  refreshPublicRooms: "Rifresko dhomat publike",
  loadingRooms: "Duke ngarkuar dhomat…",
  noPublicRooms: "S'ka dhoma publike të hapura tani. Krijo një!",
  codeCol: "Kodi",
  hostCol: "Nikoqiri",
  createdCol: "Krijuar",
  justNow: "tani",
  minutesAgo: "{m}min më parë",
  hoursAgo: "{h}h më parë",
  joinHostsGame: "Bashkohu në lojën e {host}",
  room: "Dhoma",
  takeASeat: "Merr vend",
  cancel: "Anulo",

  // Game room
  youStart: "Ti fillon!",
  oppStarts: "{name} fillon",
  leaveForfeit: "Nëse del tani, e humb lojën. Dëshiron të dalësh?",
  backHome: "Kthehu në fillim",
  connectingToRoom: "Duke u lidhur me dhomën…",
  roomFull: "Dhoma është plot",
  roomFullDesc: "Kjo dhomë i ka tashmë dy lojtarë. Kërkoji shokut një kod të ri dhome.",
  dealingCards: "Duke ndarë letrat…",
  waitingForOpponent: "Në pritje të kundërshtarit",
  shareCode: "Ndaje këtë kod me një shok:",
  linkCopied: "Linku u kopjua!",
  copyInviteLink: "Kopjo linkun e ftesës",
  waiting: "Në pritje…",
  closeRoom: "Mbyll dhomën",
  copied: "U kopjua!",
  copyInvite: "Kopjo ftesën",
  connected: "Lidhur",
  reconnecting: "Duke u rilidhur…",
  leave: "Dil",
  connectionLost: "Lidhja humbi — duke u rilidhur…",
  oppDisconnected: "{name} u shkëput — duke pritur të rilidhet ({s}s)",
  deck: "Pakoja",
  pileCount: "Grumbulli ({n})",
  youPlayed: "Ti hodhe",
  oppPlayed: "{name} hodhi",
  capturedPile: "e mori grumbullin!",
  yourTurn: "Radha jote",
  oppTurn: "Radha e {name}",
  points: "pikë",
  gameOver: "Loja mbaroi",
  playingNow: "Duke luajtur…",
  noCardsInHand: "(pa letra në dorë)",
  capturedChip: "të marra",
  offline: "offline",
  turn: "Radha",

  // End-game modal
  youWon: "Fitove!",
  youLost: "Humbe",
  itsATie: "Barazim",
  oppNoReconnect: "{name} nuk u rilidh në kohë.",
  oppLeftGame: "{name} e la lojën.",
  youLeftGame: "Ti e le lojën.",
  scoring: "Pikët",
  aces: "Asat",
  jacks: "Fantët",
  twoOfClubs: "2 Spathi",
  tenOfDiamonds: "10 Karo",
  queens: "Damat",
  kings: "Mbretërit",
  tens: "Dhjetëshet",
  mostCards: "Më shumë letra (+3)",
  pishtiBonuses: "Bonuset e pishpirikut",
  total: "Totali",
  rematchUnavailable: "Revanshi s'është i mundur — kundërshtari u largua.",
  waitingForName: "Duke pritur {name}…",
  requestExpires: "Kërkesa skadon për {s}s",
  wantsRematch: "{name} kërkon revansh!",
  accept: "Prano",
  decline: "Refuzo",
  youDeclinedRematch: "Ti e refuzove revanshin.",
  oppDeclinedRematch: "{name} e refuzoi revanshin.",
  rematchExpired: "Kërkesa për revansh skadoi.",
  sending: "Duke dërguar…",
  playAgain: "Luaj përsëri",
  leaveRoom: "Dil nga dhoma",

  // 404 / error pages
  pageNotFound: "Faqja nuk u gjet",
  pageNotFoundDesc: "Faqja që kërkon nuk ekziston ose është zhvendosur.",
  goHome: "Kthehu në fillim",
  pageDidntLoad: "Kjo faqe nuk u ngarkua",
  pageDidntLoadDesc: "Diçka shkoi keq nga ana jonë. Provo ta rifreskosh ose kthehu në fillim.",
  tryAgain: "Provo përsëri",

  // Errors
  somethingWentWrong: "Diçka shkoi keq",
  failedCreateRoom: "Krijimi i dhomës dështoi",
  failedJoinRoom: "Bashkimi në dhomë dështoi",
  failedLoadRoom: "Ngarkimi i dhomës dështoi",
  moveFailed: "Lëvizja dështoi",
  rematchFailed: "Revanshi dështoi",
  "error.ROOM_NOT_FOUND": "Ajo dhomë nuk ekziston (ose ka skaduar).",
  "error.ROOM_FULL": "Kjo dhomë i ka tashmë dy lojtarë.",
  "error.NOT_A_ROOM_PLAYER": "Ti nuk je lojtar në këtë dhomë.",
  "error.ALREADY_IN_ROOM": "Je tashmë në këtë dhomë — hap tabin origjinal ose ribashkohu.",
  "error.NOT_YOUR_TURN": "S'është radha jote ende.",
  "error.INVALID_CARD": "S'mund ta hedhësh atë letër.",
  "error.GAME_ALREADY_STARTED": "Kjo lojë ka filluar tashmë.",
  "error.GAME_NOT_STARTED": "Loja s'ka filluar ende.",
  "error.GAME_FINISHED": "Loja ka mbaruar tashmë.",
  "error.REMATCH_NOT_AVAILABLE": "Revanshi s'është i mundur tani.",
  "error.STALE_EVENT": "Ai veprim ishte i vjetëruar — loja ka vazhduar.",
  "error.OPPONENT_STILL_CONNECTED": "Kundërshtari yt është ende i lidhur.",
  "error.VERSION_CONFLICT": "Loja u përditësua në të njëjtën kohë — provo përsëri.",
  "error.INVALID_ACTION": "Ai veprim s'është i mundur tani.",

  language: "Gjuha",
};

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, sq };

type Params = Record<string, string | number>;

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] !== undefined ? String(params[key]) : match,
  );
}

/**
 * Current language for non-component code (kept in sync by the provider).
 * Components should use `useI18n()` instead so they re-render on change.
 */
let currentLang: Lang = "en";

export function translate(key: TranslationKey, params?: Params): string {
  return format(dictionaries[currentLang][key], params);
}

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "sq") return stored;
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (langs.some((l) => l?.toLowerCase().startsWith("sq"))) return "sq";
    // Albania. (Kosovo shares Europe/Belgrade, so we can't key off it.)
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Tirane") return "sq";
  } catch {
    // SSR or restricted environment — fall through to English
  }
  return "en";
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Start with "en" so SSR markup and first client render match, then apply
  // the detected/stored language right after mount.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const detected = detectLang();
    currentLang = detected;
    setLangState(detected);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    currentLang = next;
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // storage unavailable — the choice just won't persist
    }
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const { lang, setLang } = useContext(LanguageContext);
  const t = useCallback(
    (key: TranslationKey, params?: Params) => format(dictionaries[lang][key], params),
    [lang],
  );
  return { lang, setLang, t };
}
