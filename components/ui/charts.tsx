"use client";

import { useId } from "react";
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
import { useTheme, type Theme } from "@/components/theme-context";

/*
 * Chart colours are resolved in JS from the active theme rather than through
 * the `[data-theme]` CSS variables the rest of the UI uses: Recharts emits
 * `fill` / `stroke` as SVG *presentation attributes*, and `var()` is not valid
 * there. Only the tooltip (a real style object) could take a variable, and
 * splitting the palette across two mechanisms is worse than one hook.
 *
 * The light palette is not a tint of the dark one — chart marks are thin lines,
 * small dots, and coloured tooltip labels, so each slot moves to a ~600/700
 * shade of the same hue to stay legible on a near-white surface. Slot 7 is the
 * exception: dark uses a second, lighter violet, which has no readable light
 * counterpart distinct from slot 2, so light substitutes purple.
 */
const PALETTE: Record<Theme, string[]> = {
  dark: ["#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#ef4444", "#06b6d4", "#a78bfa", "#22c55e"],
  light: ["#2563eb", "#7c3aed", "#0f766e", "#b45309", "#dc2626", "#0e7490", "#9333ea", "#15803d"],
};

/** Fixed-meaning series colours (success/failure), outside the rotating palette. */
const TONES: Record<Theme, { success: string; danger: string }> = {
  dark: { success: "#22c55e", danger: "#ef4444" },
  light: { success: "#15803d", danger: "#dc2626" },
};

const CHROME: Record<Theme, {
  axis: string;
  axisLine: string;
  cursor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipFg: string;
  tooltipLabel: string;
  tooltipShadow: string;
}> = {
  dark: {
    axis: "#475569",
    axisLine: "rgba(148,163,184,0.2)",
    cursor: "rgba(148,163,184,0.08)",
    tooltipBg: "rgba(2,6,23,0.95)",
    tooltipBorder: "1px solid rgba(148,163,184,0.25)",
    tooltipFg: "#e5e7eb",
    tooltipLabel: "#94a3b8",
    tooltipShadow: "0 8px 24px rgba(2,6,23,0.5)",
  },
  light: {
    axis: "#475569",
    axisLine: "rgba(100,116,139,0.35)",
    cursor: "rgba(15,23,42,0.06)",
    tooltipBg: "rgba(255,255,255,0.98)",
    tooltipBorder: "1px solid rgba(100,116,139,0.28)",
    tooltipFg: "#0f172a",
    tooltipLabel: "#475569",
    tooltipShadow: "0 6px 16px rgba(15,23,42,0.12)",
  },
};

/** The rotating categorical palette for the active theme. */
export function useChartPalette(): string[] {
  return PALETTE[useTheme().theme];
}

/** Success/failure series colours for the active theme. */
export function useChartTones(): { success: string; danger: string } {
  return TONES[useTheme().theme];
}

/** Axis, cursor, and tooltip styling for the active theme. */
function useChartChrome() {
  const c = CHROME[useTheme().theme];
  return {
    axis: { stroke: c.axis, fontSize: 11 },
    axisLine: { stroke: c.axisLine },
    cursor: { fill: c.cursor },
    tooltip: {
      contentStyle: {
        background: c.tooltipBg,
        border: c.tooltipBorder,
        borderRadius: 8,
        boxShadow: c.tooltipShadow,
        fontSize: 11,
        color: c.tooltipFg,
      },
      labelStyle: { color: c.tooltipLabel },
    },
  };
}

/** Tiny inline sparkline for stat cards. */
export function Sparkline({
  data,
  dataKey,
  color,
  height = 32,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  const palette = useChartPalette();
  // The gradient is referenced by `url(#id)`, so the id must never be derived
  // from a colour — a `#` in the value truncates the fragment. useId's
  // delimiters vary by React version, so keep only url-safe characters.
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const stroke = color ?? palette[0];
  if (data.length === 0) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={1.5} fill={`url(#${gradientId})`} isAnimationActive={false} />
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
  const chrome = useChartChrome();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <XAxis dataKey={xKey} tick={chrome.axis} tickLine={false} axisLine={chrome.axisLine} minTickGap={24} />
        <YAxis tick={chrome.axis} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip {...chrome.tooltip} />
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
  color,
  height = 220,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  xKey: string;
  color?: string;
  height?: number;
}) {
  const chrome = useChartChrome();
  const palette = useChartPalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <XAxis dataKey={xKey} tick={chrome.axis} tickLine={false} axisLine={chrome.axisLine} interval={0} angle={-20} textAnchor="end" height={48} />
        <YAxis tick={chrome.axis} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip {...chrome.tooltip} cursor={chrome.cursor} />
        <Bar dataKey={dataKey} fill={color ?? palette[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
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
  const chrome = useChartChrome();
  const palette = useChartPalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Tooltip {...chrome.tooltip} />
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="none" isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={palette[i % palette.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
