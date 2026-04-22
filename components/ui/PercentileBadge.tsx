"use client";
import clsx from "clsx";

interface Props {
  value: number;
  benchmark: { p25: number; p50: number; p75: number; p90: number };
  invertColor?: boolean;
}

export function PercentileBadge({ value, benchmark, invertColor = false }: Props) {
  let label: string;
  let tone: "green" | "blue" | "amber" | "rose" = "amber";
  const { p25, p50, p75, p90 } = benchmark;

  if (invertColor) {
    if (value <= p25) tone = "green", label = "Top 25%";
    else if (value <= p50) tone = "blue", label = "Top 50%";
    else if (value <= p75) tone = "amber", label = "Abaixo mediana";
    else tone = "rose", label = "Bottom 25%";
  } else {
    if (value >= p90) tone = "green", label = "Top 10%";
    else if (value >= p75) tone = "blue", label = "Top 25%";
    else if (value >= p50) tone = "amber", label = "Mediana";
    else tone = "rose", label = "Bottom 50%";
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md",
        tone === "green" && "bg-emerald-50 text-emerald-700 border border-emerald-200",
        tone === "blue" && "bg-blue-50 text-blue-700 border border-blue-200",
        tone === "amber" && "bg-amber-50 text-amber-700 border border-amber-200",
        tone === "rose" && "bg-rose-50 text-rose-700 border border-rose-200"
      )}
      title={`p25=${p25.toFixed(1)}, p50=${p50.toFixed(1)}, p75=${p75.toFixed(1)}, p90=${p90.toFixed(1)}`}
    >
      {label}
    </span>
  );
}
