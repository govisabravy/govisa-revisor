"use client";
import { Line, LineChart, ResponsiveContainer } from "recharts";

interface Props {
  data: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color = "#3b82f6", height = 24 }: Props) {
  const d = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ width: 80, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={d}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
