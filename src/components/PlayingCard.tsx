import type { CSSProperties } from "react";
import type { Card } from "@/lib/pishpirik";

const SUIT_GLYPH: Record<Card["s"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** CSS transform for a held-hand arch: pivot from bottom, outer cards drop slightly. */
export function handFanStyle(
  index: number,
  count: number,
  opts?: { stepDeg?: number; dropPx?: number },
): CSSProperties {
  if (count <= 1) return { zIndex: 1 };
  const step = opts?.stepDeg ?? 11;
  const drop = opts?.dropPx ?? 5;
  const mid = (count - 1) / 2;
  const offset = index - mid;
  const rotate = offset * step;
  const translateY = Math.abs(offset) * drop;
  return {
    transform: `rotate(${rotate}deg) translateY(${translateY}px)`,
    zIndex: index + 1,
  };
}
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
  size?: "xs" | "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;
  className?: string;
  style?: CSSProperties;
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
      ? "w-[5.5rem] h-[8.25rem] text-2xl sm:w-24 sm:h-36 sm:text-3xl md:w-28 md:h-[10.5rem] md:text-4xl"
      : size === "sm"
        ? "w-10 h-14 text-xs sm:w-12 sm:h-16 sm:text-sm"
        : size === "xs"
          ? "w-8 h-11 text-[10px] sm:w-9 sm:h-13 sm:text-[11px]"
          : "w-16 h-24 text-xl sm:w-20 sm:h-[7.5rem] sm:text-2xl md:w-24 md:h-36 md:text-3xl";

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
      className={`playing-card ${dims} flex flex-col justify-between ${size === "xs" ? "p-1" : "p-1.5"} select-none touch-manipulation ${
        clickable
          ? "cursor-pointer transition-transform duration-150 hover:-translate-y-4 hover:scale-[1.04] focus-visible:-translate-y-4 focus-visible:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)] active:scale-95"
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
      {size !== "xs" && (
        <div className="text-center text-[1.4em] leading-none opacity-90">{glyph}</div>
      )}
      <div className="flex flex-col items-end leading-none font-bold rotate-180">
        <span>{card.r}</span>
        <span className="text-[0.7em]">{glyph}</span>
      </div>
    </button>
  );
}
