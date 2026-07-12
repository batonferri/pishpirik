import { useI18n, type Lang } from "@/lib/i18n";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "sq", label: "SQ" },
  { value: "en", label: "EN" },
];

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
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
