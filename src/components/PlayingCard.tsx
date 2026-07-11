import type { Card } from "@/lib/pishpirik";

const SUIT_GLYPH: Record<Card["s"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_NAME: Record<Card["s"], string> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};
const RED: Card["s"][] = ["H", "D"];

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function PlayingCard({
  card,
  faceDown,
  size = "md",
  onClick,
  disabled,
  highlight,
  className = "",
  style,
}: Props) {
  const dims =
    size === "lg"
      ? "w-16 h-24 text-xl sm:w-20 sm:h-30 sm:text-2xl md:w-24 md:h-36 md:text-3xl"
      : size === "sm"
        ? "w-10 h-14 text-xs sm:w-12 sm:h-16 sm:text-sm"
        : "w-14 h-20 text-lg sm:w-16 sm:h-24 sm:text-xl";

  if (faceDown || !card) {
    return <div className={`card-back ${dims} ${className}`} style={style} aria-hidden />;
  }

  const isRed = RED.includes(card.s);
  const glyph = SUIT_GLYPH[card.s];
  const clickable = !!onClick && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-label={`${card.r} of ${SUIT_NAME[card.s]}`}
      className={`playing-card ${dims} flex flex-col justify-between p-1.5 select-none touch-manipulation ${
        clickable
          ? "cursor-pointer transition-transform duration-150 hover:-translate-y-3 focus-visible:-translate-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)] active:scale-95"
          : "cursor-default"
      } ${highlight ? "ring-2 ring-[color:var(--color-gold)]" : ""} ${
        disabled && onClick ? "opacity-60 saturate-50" : ""
      } ${className}`}
      style={{ color: isRed ? "var(--color-card-red)" : "var(--color-card-black)", ...style }}
    >
      <div className="flex flex-col items-start leading-none font-bold">
        <span>{card.r}</span>
        <span className="text-[0.7em]">{glyph}</span>
      </div>
      <div className="text-center text-[1.4em] leading-none opacity-90">{glyph}</div>
      <div className="flex flex-col items-end leading-none font-bold rotate-180">
        <span>{card.r}</span>
        <span className="text-[0.7em]">{glyph}</span>
      </div>
    </button>
  );
}
