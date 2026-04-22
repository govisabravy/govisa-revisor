"use client";
import { Bar, BarChart as RChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS: Record<string, string> = {
  blue: "#3b82f6", indigo: "#6366f1", emerald: "#10b981",
  rose: "#f43f5e", amber: "#f59e0b", slate: "#64748b"
};

interface Props {
  data: any[];
  index: string;
  categories: string[];
  colors?: string[];
  layout?: "horizontal" | "vertical";
  valueFormatter?: (v: number) => string;
  height?: number;
}

export function BarChart({ data, index, categories, colors = ["blue"], layout = "horizontal", valueFormatter, height = 260 }: Props) {
  const isVertical = layout === "vertical";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RChart data={data} layout={layout}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={isVertical} horizontal={!isVertical} />
        {isVertical ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={valueFormatter ? (v) => valueFormatter(Number(v)) : undefined} />
            <YAxis type="category" dataKey={index} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={140} />
          </>
        ) : (
          <>
            <XAxis dataKey={index} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={valueFormatter ? (v) => valueFormatter(Number(v)) : undefined} />
          </>
        )}
        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={valueFormatter ? (v: any) => valueFormatter(Number(v)) : undefined} />
        {categories.map((c, i) => (
          <Bar key={c} dataKey={c} fill={COLORS[colors[i] ?? "blue"]} radius={[4, 4, 0, 0]} />
        ))}
      </RChart>
    </ResponsiveContainer>
  );
}
