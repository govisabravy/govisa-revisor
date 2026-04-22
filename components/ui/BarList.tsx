"use client";

interface Props {
  data: Array<{ name: string; value: number }>;
  valueFormatter?: (v: number) => string;
  color?: string;
}

export function BarList({ data, valueFormatter, color = "#3b82f6" }: Props) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="relative flex items-center justify-between rounded-md overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-md opacity-20" style={{ backgroundColor: color, width: `${(d.value / max) * 100}%` }} />
          <span className="relative z-10 px-3 py-1.5 text-sm text-slate-800 truncate">{d.name}</span>
          <span className="relative z-10 px-3 py-1.5 text-sm font-semibold text-slate-900">{valueFormatter ? valueFormatter(d.value) : d.value}</span>
        </div>
      ))}
      {data.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">Sem dados</div>}
    </div>
  );
}
