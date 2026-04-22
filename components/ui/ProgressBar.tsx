"use client";
import clsx from "clsx";

interface Props {
  value: number;
  max: number;
  label?: string;
  color?: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({ value, max, label, color = "#3b82f6", showValue = true, className }: Props) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={clsx("w-full", className)}>
      {(label || showValue) && (
        <div className="flex justify-between text-xs text-slate-600 mb-1">
          {label && <span>{label}</span>}
          {showValue && <span className="font-semibold text-slate-900">{value}/{max}</span>}
        </div>
      )}
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
