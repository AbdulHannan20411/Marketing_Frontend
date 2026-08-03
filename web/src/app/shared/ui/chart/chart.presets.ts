import type { ApexOptions } from 'apexcharts';

/** Palette and typography shared by every chart so they read as one system. */
export const CHART_COLORS = {
  primary: '#16a34a',
  accent: '#22c55e',
  soft: '#86efac',
  amber: '#f59e0b',
  red: '#dc2626',
  slate: '#94a3b8',
} as const;

const FONT_FAMILY = "'Inter', ui-sans-serif, system-ui, sans-serif";

const BASE_GRID: ApexOptions['grid'] = {
  borderColor: '#e5e7eb',
  strokeDashArray: 4,
  padding: { left: 4, right: 8, top: 0 },
  xaxis: { lines: { show: false } },
  yaxis: { lines: { show: true } },
};

const AXIS_LABEL_STYLE = {
  colors: '#6b7280',
  fontSize: '11px',
  fontFamily: FONT_FAMILY,
};

function compact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(Math.round(value));
}

export interface TrendSeriesInput {
  readonly categories: readonly string[];
  readonly sent: readonly number[];
  readonly delivered: readonly number[];
  readonly read: readonly number[];
}

export function areaTrendChart(input: TrendSeriesInput): ApexOptions {
  return {
    series: [
      { name: 'Sent', data: [...input.sent] },
      { name: 'Delivered', data: [...input.delivered] },
      { name: 'Read', data: [...input.read] },
    ],
    chart: {
      type: 'area',
      height: 300,
      fontFamily: FONT_FAMILY,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 400 },
    },
    colors: [CHART_COLORS.primary, CHART_COLORS.accent, CHART_COLORS.soft],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.02, stops: [0, 90, 100] },
    },
    grid: BASE_GRID,
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '12px',
      markers: { size: 5 },
      itemMargin: { horizontal: 8 },
    },
    xaxis: {
      categories: [...input.categories],
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: AXIS_LABEL_STYLE, rotate: 0, hideOverlappingLabels: true },
      tooltip: { enabled: false },
    },
    yaxis: { labels: { style: AXIS_LABEL_STYLE, formatter: compact } },
    tooltip: { shared: true, intersect: false, y: { formatter: (value) => compact(value) } },
  };
}

export interface FunnelInput {
  readonly labels: readonly string[];
  readonly values: readonly number[];
}

export function funnelChart(input: FunnelInput): ApexOptions {
  return {
    series: [{ name: 'Messages', data: [...input.values] }],
    chart: {
      type: 'bar',
      height: 300,
      fontFamily: FONT_FAMILY,
      toolbar: { show: false },
    },
    colors: [CHART_COLORS.primary],
    plotOptions: {
      bar: { horizontal: true, borderRadius: 6, barHeight: '58%', distributed: true },
    },
    states: { hover: { filter: { type: 'lighten' } } },
    dataLabels: {
      enabled: true,
      formatter: (value) => compact(Number(value)),
      style: { fontSize: '11px', fontWeight: 600, colors: ['#ffffff'], fontFamily: FONT_FAMILY },
      offsetX: 24,
    },
    legend: { show: false },
    grid: { ...BASE_GRID, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
    xaxis: {
      categories: [...input.labels],
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: AXIS_LABEL_STYLE, formatter: (value) => compact(Number(value)) },
    },
    yaxis: { labels: { style: AXIS_LABEL_STYLE } },
    tooltip: { y: { formatter: (value) => compact(value) } },
  };
}

export function deliveryDonutChart(delivered: number, failed: number, pending: number): ApexOptions {
  return {
    series: [delivered, failed, pending],
    labels: ['Delivered', 'Failed', 'Pending'],
    chart: { type: 'donut', height: 280, fontFamily: FONT_FAMILY },
    colors: [CHART_COLORS.primary, CHART_COLORS.red, CHART_COLORS.slate],
    stroke: { width: 0 },
    dataLabels: { enabled: false },
    legend: {
      position: 'bottom',
      fontSize: '12px',
      markers: { size: 5 },
      itemMargin: { horizontal: 8, vertical: 4 },
    },
    plotOptions: {
      pie: {
        donut: {
          size: '72%',
          labels: {
            show: true,
            value: {
              fontSize: '22px',
              fontWeight: 600,
              color: '#1e293b',
              formatter: (value) => compact(Number(value)),
            },
            total: {
              show: true,
              label: 'Total',
              color: '#6b7280',
              fontSize: '12px',
              formatter: (w) =>
                compact(
                  (w.globals.seriesTotals as number[]).reduce((sum, value) => sum + value, 0),
                ),
            },
          },
        },
      },
    },
    tooltip: { y: { formatter: (value) => compact(value) } },
  };
}

export function throughputChart(labels: readonly string[], values: readonly number[]): ApexOptions {
  return {
    series: [{ name: 'Requests/min', data: [...values] }],
    chart: {
      type: 'bar',
      height: 240,
      fontFamily: FONT_FAMILY,
      toolbar: { show: false },
    },
    colors: [CHART_COLORS.accent],
    plotOptions: { bar: { borderRadius: 3, columnWidth: '58%' } },
    dataLabels: { enabled: false },
    grid: BASE_GRID,
    xaxis: {
      categories: [...labels],
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: AXIS_LABEL_STYLE, hideOverlappingLabels: true },
    },
    yaxis: { labels: { style: AXIS_LABEL_STYLE, formatter: compact } },
    tooltip: { y: { formatter: (value) => compact(value) } },
  };
}
