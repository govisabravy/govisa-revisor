"use client";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import clsx from "clsx";

interface Props {
  value: number;
  invertColor?: boolean;
  suffix?: string;
}

export function DeltaBadge({ value, invertColor = false, suffix = "%" }: Props) {
  const up = value > 0;
  const down = value < 0;
  const neutral = value === 0;
  const positive = invertColor ? down : up;
  const negative = invertColor ? up : down;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md",
        neutral && "bg-slate-100 text-slate-500",
        positive && "bg-emerald-50 text-emerald-700",
        negative && "bg-rose-50 text-rose-700"
      )}
      title="vs período anterior"
    >
      {neutral ? <Minus className="w-3 h-3" /> : up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}
