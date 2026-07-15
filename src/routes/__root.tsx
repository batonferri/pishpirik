import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import "@/lib/browser-bootstrap";
import appCss from "../styles.css?url";
import { runBrowserRecovery } from "@/lib/browser-bootstrap";
import { LanguageProvider, useI18n } from "@/lib/i18n";

function NotFoundComponent() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("pageNotFound")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("pageNotFoundDesc")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("pageDidntLoad")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("pageDidntLoadDesc")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("tryAgain")}
          </button>
          <button
            onClick={() => {
              void runBrowserRecovery().then(() => window.location.reload());
            }}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("resetAppData")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Pishpirik — Play the card game online" },
      {
        name: "description",
        content:
          "Play Pishpirik, the classic card game, 1v1 online with a friend. Create a room, share the code, and play.",
      },
      { property: "og:title", content: "Pishpirik — Play the card game online" },
      {
        property: "og:description",
        content:
          "Play Pishpirik, the classic card game, 1v1 online with a friend. Create a room, share the code, and play.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Pishpirik — Play the card game online" },
      {
        name: "twitter:description",
        content:
          "Play Pishpirik, the classic card game, 1v1 online with a friend. Create a room, share the code, and play.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="pishpirik.startupOk";if(sessionStorage.getItem(k))return;window.setTimeout(function(){if(document.documentElement.dataset.pishpirikReady==="1")return;var r=document.getElementById("pishpirik-startup-recovery");if(r)return;var d=document.createElement("div");d.id="pishpirik-startup-recovery";d.setAttribute("role","alert");d.style.cssText="position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#0b0f14;color:#f5f5f5;padding:1.5rem;font:15px/1.5 system-ui,sans-serif";d.innerHTML='<div style="max-width:28rem;text-align:center"><h1 style="font-size:1.25rem;margin:0 0 0.5rem">Pishpirik didn\\'t start</h1><p style="color:#cbd5e1;margin:0 0 1rem">The page loaded but the app never finished starting. Try reloading or reset app data.</p><div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap"><button type="button" id="pishpirik-inline-reload" style="padding:0.5rem 1rem;border-radius:0.375rem;border:0;background:#eab308;color:#111;font:inherit;cursor:pointer">Reload</button></div></div>';document.body?document.body.appendChild(d):document.addEventListener("DOMContentLoaded",function(){document.body.appendChild(d)});document.getElementById("pishpirik-inline-reload")?.addEventListener("click",function(){location.reload()});},20000);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    window.__pishpirikMarkStartupReady?.();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
