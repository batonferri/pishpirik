import type { Card } from "@/lib/pishpirik";

const SUIT_GLYPH: Record<Card["s"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED: Card["s"][] = ["H", "D"];

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;
}

export function PlayingCard({ card, faceDown, size = "md", onClick, disabled, highlight }: Props) {
  const dims =
    size === "lg"
      ? "w-24 h-36 text-3xl"
      : size === "sm"
        ? "w-12 h-16 text-sm"
        : "w-16 h-24 text-xl";

  if (faceDown || !card) {
    return <div className={`card-back ${dims}`} aria-hidden />;
  }

  const isRed = RED.includes(card.s);
  const glyph = SUIT_GLYPH[card.s];
  const clickable = !!onClick && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-label={`${card.r} of ${card.s}`}
      className={`playing-card ${dims} flex flex-col justify-between p-1.5 select-none ${
        clickable ? "cursor-pointer transition-transform hover:-translate-y-2" : "cursor-default"
      } ${highlight ? "ring-4 ring-[var(--color-gold)] -translate-y-2" : ""} ${
        disabled ? "opacity-70" : ""
      }`}
      style={{ color: isRed ? "var(--color-card-red)" : "var(--color-card-black)" }}
    >
      <div className="flex flex-col items-start leading-none font-bold">
        <span>{card.r}</span>
        <span className="text-base">{glyph}</span>
      </div>
      <div className="text-center text-2xl leading-none opacity-90">{glyph}</div>
      <div className="flex flex-col items-end leading-none font-bold rotate-180">
        <span>{card.r}</span>
        <span className="text-base">{glyph}</span>
      </div>
    </button>
  );
}
