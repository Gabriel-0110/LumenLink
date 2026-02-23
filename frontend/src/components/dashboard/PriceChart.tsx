import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType, type UTCTimestamp } from 'lightweight-charts';
import type { DashboardData } from '../../types/api';

interface Props {
  data: DashboardData;
}

export function PriceChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  const symbol = data.symbols?.[0] ?? 'BTC-USD';
  const sparkline = data.sparklines?.[symbol] ?? [];

  // Compute price change
  const first = sparkline[0]?.close ?? 0;
  const last = sparkline[sparkline.length - 1]?.close ?? 0;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2d40' },
        horzLines: { color: '#1e2d40' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: '#06b6d4', width: 1, style: 2 },
        horzLine: { color: '#06b6d4', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#1e2d40',
      },
      timeScale: {
        borderColor: '#1e2d40',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addAreaSeries({
      lineColor: '#06b6d4',
      topColor: 'rgba(6, 182, 212, 0.3)',
      bottomColor: 'rgba(6, 182, 212, 0.02)',
      lineWidth: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Update data
  useEffect(() => {
    if (!seriesRef.current || sparkline.length === 0) return;

    const lineData = sparkline.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      value: c.close,
    }));

    seriesRef.current.setData(lineData);
    chartRef.current?.timeScale().fitContent();
  }, [sparkline]);

  const priceStr = last > 0
    ? `$${last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';

  return (
    <div className="card flex flex-col">
      <div className="card-label">{symbol} / {data.interval}</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[2rem] font-extrabold tracking-tight">{priceStr}</span>
        <span
          className={`text-sm font-semibold ${changePct >= 0 ? 'text-profit' : 'text-loss'}`}
        >
          {changePct >= 0 ? '+' : ''}
          {changePct.toFixed(2)}%
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-[220px]" />
    </div>
  );
}
