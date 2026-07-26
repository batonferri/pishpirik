import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { initSounds, isMuted, toggleMuted } from "@/lib/sounds";

export function SoundToggle({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    initSounds();
    setMutedState(isMuted());
  }, []);

  return (
    <button
      type="button"
      onClick={() => setMutedState(toggleMuted())}
      aria-pressed={muted}
      aria-label={muted ? t("soundOff") : t("soundOn")}
      title={muted ? t("soundOff") : t("soundOn")}
      className={`inline-flex items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-input)] p-1.5 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] btn-press ${className}`}
    >
      {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
    </button>
  );
}
