"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const PALETTE = ["#3b82f6", "#6366f1", "#10b981", "#f43f5e", "#f59e0b", "#64748b"];

interface Props {
  data: Array<{ name: string; value: number }>;
  height?: number;
  valueFormatter?: (v: number) => string;
}

export function DonutChart({ data, height = 220, valueFormatter }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="50%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={valueFormatter ? (v: any) => valueFormatter(Number(v)) : undefined} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1 text-sm">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
              <span className="text-slate-700">{d.name}</span>
            </div>
            <span className="font-semibold text-slate-900">{valueFormatter ? valueFormatter(d.value) : d.value} <span className="text-slate-400 font-normal">({total > 0 ? Math.round((d.value/total)*100) : 0}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
