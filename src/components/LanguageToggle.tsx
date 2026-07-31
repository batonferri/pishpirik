import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n, type Lang } from "@/lib/i18n";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "sq", label: "SQ" },
  { value: "en", label: "EN" },
];

export function LanguageToggle({
  className = "",
  variant = "pills",
  large,
  menuBelow,
}: {
  className?: string;
  /** `pills` = SQ/EN segmented control; `menu` = settings icon + dropdown. */
  variant?: "pills" | "menu";
  large?: boolean;
  menuBelow?: boolean;
}) {
  const { lang, setLang, t } = useI18n();

  if (variant === "menu") {
    return (
      <LanguageMenu
        className={className}
        large={large}
        menuBelow={menuBelow}
        lang={lang}
        setLang={setLang}
        label={t("language")}
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className={`inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-input)] p-0.5 text-xs font-semibold ${className}`}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={lang === opt.value}
          onClick={() => setLang(opt.value)}
          className={`rounded-full px-2.5 py-1 transition-colors btn-press ${
            lang === opt.value
              ? "bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)]"
              : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function LanguageMenu({
  className,
  large,
  menuBelow,
  lang,
  setLang,
  label,
}: {
  className?: string;
  large?: boolean;
  menuBelow?: boolean;
  lang: Lang;
  setLang: (lang: Lang) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`btn-press rounded-full border border-[color:var(--color-border)] transition-colors ${
          large ? "p-2 sm:p-3 bg-[color:var(--color-input)]/80" : "p-1.5 sm:p-2"
        } ${
          open
            ? "bg-[color:var(--color-secondary)] text-[color:var(--color-foreground)]"
            : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-secondary)]"
        }`}
      >
        <Settings
          className={large ? "w-5 h-5 sm:w-6 sm:h-6" : "w-4 h-4"}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute z-40 panel p-1.5 min-w-[7.5rem] anim-rise ${
            menuBelow ? "top-full left-0 mt-2" : "bottom-full left-0 mb-2"
          }`}
        >
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-widest text-[color:var(--color-muted-foreground)]">
            {label}
          </div>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={lang === opt.value}
              onClick={() => {
                setLang(opt.value);
                setOpen(false);
              }}
              className={`btn-press w-full text-left rounded-[calc(var(--radius)-2px)] px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                lang === opt.value
                  ? "bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)]"
                  : "text-[color:var(--color-foreground)] hover:bg-[color:var(--color-secondary)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
