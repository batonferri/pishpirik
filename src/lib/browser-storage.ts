// App-owned browser storage with schema versioning and safe recovery.
// Only touches keys prefixed with "pishpirik." — never calls localStorage.clear().

export const STORAGE_SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  schema: "pishpirik.storageSchema",
  player: "pishpirik.player",
  lang: "pishpirik.lang",
  tokenPrefix: "pishpirik.token.",
  diagnostics: "pishpirik.diagnostics",
} as const;

export const SESSION_KEYS = {
  reloadAfterCleanup: "pishpirik.reloadAfterCleanup",
  startupOk: "pishpirik.startupOk",
} as const;

export type Lang = "en" | "sq";

export interface Player {
  id: string;
  name: string;
}

function isAppOwnedKey(key: string): boolean {
  return key.startsWith("pishpirik.");
}

function isRoomTokenKey(key: string): boolean {
  return key.startsWith(STORAGE_KEYS.tokenPrefix);
}

export function listAppLocalStorageKeys(): string[] {
  if (typeof localStorage === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isAppOwnedKey(key)) keys.push(key);
  }
  return keys.sort();
}

export function listSupabaseAuthKeys(): string[] {
  if (typeof localStorage === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("sb-") || key.includes("-auth-token"))) keys.push(key);
  }
  return keys.sort();
}

export function removeSupabaseAuthKeys(): string[] {
  const removed = listSupabaseAuthKeys();
  for (const key of removed) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore quota / privacy errors
    }
  }
  return removed;
}

function parsePlayer(raw: string): Player | null {
  try {
    const p = JSON.parse(raw) as Partial<Player>;
    if (!p || typeof p.id !== "string" || !p.id) return null;
    if (typeof p.name !== "string") return null;
    if (p.id.length > 128 || p.name.length > 64) return null;
    return { id: p.id, name: p.name };
  } catch {
    return null;
  }
}

function parseLang(raw: string | null): Lang | null {
  return raw === "en" || raw === "sq" ? raw : null;
}

function parseRoomToken(raw: string | null): string | null {
  if (!raw || raw.length > 256) return null;
  return raw;
}

/** Validate app-owned keys and drop anything malformed or from an older schema. */
export function migrateAppStorage(): { removed: string[]; migrated: boolean } {
  if (typeof localStorage === "undefined") return { removed: [], migrated: false };

  const removed: string[] = [];
  let migrated = false;
  const current = Number(localStorage.getItem(STORAGE_KEYS.schema) ?? "0");

  if (!Number.isFinite(current) || current < STORAGE_SCHEMA_VERSION) {
    migrated = true;
  }

  const playerRaw = localStorage.getItem(STORAGE_KEYS.player);
  if (playerRaw) {
    const player = parsePlayer(playerRaw);
    if (!player) {
      localStorage.removeItem(STORAGE_KEYS.player);
      removed.push(STORAGE_KEYS.player);
    }
  }

  const lang = parseLang(localStorage.getItem(STORAGE_KEYS.lang));
  if (localStorage.getItem(STORAGE_KEYS.lang) && !lang) {
    localStorage.removeItem(STORAGE_KEYS.lang);
    removed.push(STORAGE_KEYS.lang);
  }

  for (const key of listAppLocalStorageKeys()) {
    if (!isRoomTokenKey(key)) continue;
    const token = parseRoomToken(localStorage.getItem(key));
    if (!token) {
      localStorage.removeItem(key);
      removed.push(key);
    }
  }

  try {
    localStorage.setItem(STORAGE_KEYS.schema, String(STORAGE_SCHEMA_VERSION));
  } catch {
    // storage unavailable
  }

  return { removed, migrated };
}

export function readStoredPlayer(): Player | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEYS.player);
  if (!raw) return null;
  return parsePlayer(raw);
}

export function writeStoredPlayer(player: Player): void {
  localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
}

export function readStoredLang(): Lang | null {
  if (typeof localStorage === "undefined") return null;
  return parseLang(localStorage.getItem(STORAGE_KEYS.lang));
}

export function writeStoredLang(lang: Lang): void {
  localStorage.setItem(STORAGE_KEYS.lang, lang);
}

export function readRoomToken(code: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return parseRoomToken(localStorage.getItem(STORAGE_KEYS.tokenPrefix + code.toUpperCase()));
}

export function writeRoomToken(code: string, token: string): void {
  localStorage.setItem(STORAGE_KEYS.tokenPrefix + code.toUpperCase(), token);
}

export function removeRoomToken(code: string): void {
  localStorage.removeItem(STORAGE_KEYS.tokenPrefix + code.toUpperCase());
}

export function diagnosticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(STORAGE_KEYS.diagnostics) === "1") return true;
  } catch {
    // ignore
  }
  return new URLSearchParams(window.location.search).has("pishpirik_debug");
}
