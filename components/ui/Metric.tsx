"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import clsx from "clsx";

interface Props {
  label: string;
  value: string | number;
  delta?: number;
  icon?: React.ReactNode;
}

export function Metric({ label, value, delta, icon }: Props) {
  const isUp = typeof delta === "number" && delta > 0;
  const isDown = typeof delta === "number" && delta < 0;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {icon ? <div className="text-slate-400">{icon}</div> : null}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      {typeof delta === "number" && (
        <div className={clsx("mt-2 flex items-center gap-1 text-xs font-semibold",
          isUp ? "text-emerald-600" : isDown ? "text-rose-600" : "text-slate-500")}>
          {isUp ? <ArrowUp className="w-3 h-3" /> : isDown ? <ArrowDown className="w-3 h-3" /> : null}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
