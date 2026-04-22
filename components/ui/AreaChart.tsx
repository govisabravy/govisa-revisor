"use client";
import { Area, AreaChart as RChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS: Record<string, string> = {
  blue: "#3b82f6", indigo: "#6366f1", emerald: "#10b981",
  rose: "#f43f5e", amber: "#f59e0b", slate: "#64748b"
};

interface Props {
  data: any[];
  index: string;
  categories: string[];
  colors?: string[];
  valueFormatter?: (v: number) => string;
  showLegend?: boolean;
  height?: number;
}

export function AreaChart({ data, index, categories, colors = ["blue","indigo"], valueFormatter, height = 260 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RChart data={data}>
        <defs>
          {categories.map((c, i) => (
            <linearGradient key={c} id={`grad-${c}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[colors[i] ?? "blue"]} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={COLORS[colors[i] ?? "blue"]} stopOpacity={0}/>
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey={index} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={valueFormatter ? (v) => valueFormatter(Number(v)) : undefined} />
        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={valueFormatter ? (v: any) => valueFormatter(Number(v)) : undefined} />
        {categories.map((c, i) => (
          <Area key={c} type="monotone" dataKey={c} stroke={COLORS[colors[i] ?? "blue"]} fill={`url(#grad-${c})`} strokeWidth={2} />
        ))}
      </RChart>
    </ResponsiveContainer>
  );
}
