"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { stroke: "#475569", fontSize: 11 };
const GRID_TOOLTIP = {
  contentStyle: {
    background: "rgba(2,6,23,0.95)",
    border: "1px solid rgba(148,163,184,0.25)",
    borderRadius: 8,
    fontSize: 11,
    color: "#e5e7eb",
  },
  labelStyle: { color: "#94a3b8" },
};

export const CHART_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#a78bfa",
  "#22c55e",
];

/** Tiny inline sparkline for stat cards. */
export function Sparkline({
  data,
  dataKey,
  color = "#3b82f6",
  height = 32,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  if (data.length === 0) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#spark-${dataKey}-${color})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Multi-series time line chart. */
export function TimeLineChart({
  data,
  series,
  xKey = "label",
  height = 220,
}: {
  data: Record<string, unknown>[];
  series: { key: string; label: string; color: string }[];
  xKey?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.2)" }} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip {...GRID_TOOLTIP} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal-ish vertical bar chart for breakdowns. */
export function BreakdownBarChart({
  data,
  dataKey,
  xKey,
  color = "#3b82f6",
  height = 220,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  xKey: string;
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.2)" }} interval={0} angle={-20} textAnchor="end" height={48} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip {...GRID_TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
        <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut chart for share-of-total. */
export function DonutChart({
  data,
  dataKey,
  nameKey,
  height = 220,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  nameKey: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Tooltip {...GRID_TOOLTIP} />
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="none" isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
