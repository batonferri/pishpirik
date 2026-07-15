// Runs as early as possible on the client: cleans orphaned service workers /
// cache entries, validates app storage, and optionally logs diagnostics.
import {
  SESSION_KEYS,
  diagnosticsEnabled,
  listAppLocalStorageKeys,
  listSupabaseAuthKeys,
  migrateAppStorage,
  removeSupabaseAuthKeys,
} from "./browser-storage";

const LOG_PREFIX = "[pishpirik:bootstrap]";
const STARTUP_WATCHDOG_MS = 20_000;
const FETCH_LOOP_WINDOW_MS = 5_000;
const FETCH_LOOP_THRESHOLD = 30;

declare global {
  interface Window {
    __pishpirikMarkStartupReady?: () => void;
    __pishpirikRunRecovery?: () => Promise<void>;
  }
}

function log(...args: unknown[]) {
  if (diagnosticsEnabled()) console.info(LOG_PREFIX, ...args);
}

function warn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}

async function listCacheNames(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  try {
    return [...(await caches.keys())].sort();
  } catch {
    return [];
  }
}

async function deleteAllCaches(): Promise<string[]> {
  const names = await listCacheNames();
  await Promise.all(names.map((name) => caches.delete(name)));
  return names;
}

async function unregisterAllServiceWorkers(): Promise<string[]> {
  if (!("serviceWorker" in navigator)) return [];
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const scopes = registrations.map((r) => r.scope);
    await Promise.all(registrations.map((r) => r.unregister()));
    return scopes;
  } catch {
    return [];
  }
}

async function listIndexedDbNames(): Promise<string[]> {
  if (!("indexedDB" in globalThis)) return [];
  try {
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof idb.databases !== "function") return [];
    const dbs = await idb.databases();
    return dbs.map((db) => db.name).filter((name): name is string => !!name);
  } catch {
    return [];
  }
}

async function detectLegacyBrowserData(): Promise<boolean> {
  const [registrations, cacheNames, supabaseKeys] = await Promise.all([
    "serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]),
    listCacheNames(),
    Promise.resolve(listSupabaseAuthKeys()),
  ]);

  const hadServiceWorkers = registrations.length > 0;
  const hadCaches = cacheNames.length > 0;
  const hadSupabaseAuth = supabaseKeys.length > 0;
  const { removed, migrated } = migrateAppStorage();

  return hadServiceWorkers || hadCaches || hadSupabaseAuth || removed.length > 0 || migrated;
}

async function runLegacyCleanup(): Promise<{
  serviceWorkers: string[];
  caches: string[];
  supabaseAuthKeys: string[];
  storageRemoved: string[];
}> {
  const serviceWorkers = await unregisterAllServiceWorkers();
  const cacheNames = await deleteAllCaches();
  const supabaseAuthKeys = removeSupabaseAuthKeys();
  const { removed: storageRemoved } = migrateAppStorage();

  return { serviceWorkers, caches: cacheNames, supabaseAuthKeys, storageRemoved };
}

async function logDiagnostics(phase: string): Promise<void> {
  if (!diagnosticsEnabled()) return;

  const [registrations, cacheNames, idbNames] = await Promise.all([
    "serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]),
    listCacheNames(),
    listIndexedDbNames(),
  ]);

  const sessionKeys =
    typeof sessionStorage !== "undefined"
      ? Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter(
          (k): k is string => !!k,
        )
      : [];

  console.group(`${LOG_PREFIX} diagnostics (${phase})`);
  console.info("serviceWorker controller", navigator.serviceWorker?.controller?.scriptURL ?? null);
  console.info(
    "serviceWorker registrations",
    registrations.map((r) => ({
      scope: r.scope,
      scriptURL: r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? null,
    })),
  );
  console.info("cacheStorage", cacheNames);
  console.info("localStorage (app)", listAppLocalStorageKeys());
  console.info("localStorage (supabase auth)", listSupabaseAuthKeys());
  console.info("sessionStorage keys", sessionKeys);
  console.info("indexedDB", idbNames);
  console.info("navigator.onLine", navigator.onLine);
  console.groupEnd();
}

function setupFetchLoopMonitor(): void {
  if (!diagnosticsEnabled() || typeof window.fetch !== "function") return;

  const counts = new Map<string, number[]>();

  window.fetch = ((originalFetch) =>
    function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? "GET"} ${url}`;
      const now = Date.now();
      const times = counts.get(key) ?? [];
      times.push(now);
      const recent = times.filter((t) => now - t < FETCH_LOOP_WINDOW_MS);
      counts.set(key, recent);
      if (recent.length >= FETCH_LOOP_THRESHOLD) {
        warn("possible fetch loop", { key, count: recent.length, windowMs: FETCH_LOOP_WINDOW_MS });
      }
      return originalFetch.call(window, input, init);
    })(window.fetch);
}

function showStartupRecovery(reason: string): void {
  if (document.getElementById("pishpirik-startup-recovery")) return;

  const root = document.createElement("div");
  root.id = "pishpirik-startup-recovery";
  root.setAttribute("role", "alert");
  root.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#0b0f14;color:#f5f5f5;padding:1.5rem;font:15px/1.5 system-ui,sans-serif;";
  root.innerHTML = `
    <div style="max-width:28rem;text-align:center">
      <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Pishpirik didn't start</h1>
      <p style="color:#cbd5e1;margin:0 0 1rem">${reason}</p>
      <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
        <button type="button" id="pishpirik-recovery-reload" style="padding:0.5rem 1rem;border-radius:0.375rem;border:0;background:#eab308;color:#111;font:inherit;cursor:pointer">Reload</button>
        <button type="button" id="pishpirik-recovery-reset" style="padding:0.5rem 1rem;border-radius:0.375rem;border:1px solid #475569;background:transparent;color:inherit;font:inherit;cursor:pointer">Reset app data</button>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:1rem 0 0">Reset removes only Pishpirik keys, Supabase auth leftovers, service workers, and caches.</p>
    </div>`;
  document.body.appendChild(root);

  document.getElementById("pishpirik-recovery-reload")?.addEventListener("click", () => {
    window.location.reload();
  });
  document.getElementById("pishpirik-recovery-reset")?.addEventListener("click", () => {
    void window.__pishpirikRunRecovery?.().then(() => window.location.reload());
  });
}

function setupStartupWatchdog(): void {
  if (typeof window === "undefined") return;

  let cleared = false;
  const clear = () => {
    if (cleared) return;
    cleared = true;
    try {
      sessionStorage.setItem(SESSION_KEYS.startupOk, "1");
    } catch {
      // ignore
    }
    document.documentElement.dataset.pishpirikReady = "1";
    document.getElementById("pishpirik-startup-recovery")?.remove();
  };

  window.__pishpirikMarkStartupReady = clear;

  window.setTimeout(() => {
    if (document.documentElement.dataset.pishpirikReady === "1") return;
    warn("startup watchdog fired — React did not mark ready in time");
    showStartupRecovery(
      "The app is taking unusually long to start. This can happen when stale browser data blocks startup.",
    );
  }, STARTUP_WATCHDOG_MS);
}

export async function runBrowserRecovery(): Promise<void> {
  const result = await runLegacyCleanup();
  warn("manual recovery completed", result);
  try {
    sessionStorage.removeItem(SESSION_KEYS.reloadAfterCleanup);
    sessionStorage.removeItem(SESSION_KEYS.startupOk);
  } catch {
    // ignore
  }
}

async function bootstrap(): Promise<void> {
  if (typeof window === "undefined") return;

  window.__pishpirikRunRecovery = runBrowserRecovery;
  setupStartupWatchdog();
  setupFetchLoopMonitor();

  await logDiagnostics("before-cleanup");

  const alreadyReloaded = sessionStorage.getItem(SESSION_KEYS.reloadAfterCleanup) === "1";
  const shouldClean = await detectLegacyBrowserData();

  if (shouldClean && !alreadyReloaded) {
    const result = await runLegacyCleanup();
    warn("legacy browser data cleaned — reloading once", result);
    try {
      sessionStorage.setItem(SESSION_KEYS.reloadAfterCleanup, "1");
    } catch {
      // ignore
    }
    window.location.reload();
    return;
  }

  if (alreadyReloaded) {
    try {
      sessionStorage.removeItem(SESSION_KEYS.reloadAfterCleanup);
    } catch {
      // ignore
    }
  }

  // This app intentionally does not register a service worker. If one appears later, remove it.
  const remaining = await unregisterAllServiceWorkers();
  if (remaining.length > 0) {
    warn("removed unexpected service workers", remaining);
  }

  await logDiagnostics("after-cleanup");
  log("bootstrap complete");
}

void bootstrap();
