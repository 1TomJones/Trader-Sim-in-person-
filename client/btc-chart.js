export function createBtcCandleChart(container) {
  if (!window.LightweightCharts || !container) return null;
  const chart = window.LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background: { color: '#0d1428' }, textColor: '#f7f9ff' },
    grid: { vertLines: { color: '#1f2b48' }, horzLines: { color: '#1f2b48' } },
    rightPriceScale: { borderColor: '#2b3a60' },
    timeScale: { borderColor: '#2b3a60', rightOffset: 2 },
  });
  const series = chart.addCandlestickSeries({ upColor: '#32d296', downColor: '#ff6b6b', borderUpColor: '#32d296', borderDownColor: '#ff6b6b', wickUpColor: '#32d296', wickDownColor: '#ff6b6b', priceLineVisible: false });

  return {
    setInitialCandles(candles) {
      if (!Array.isArray(candles) || !candles.length) return;
      series.setData(candles);
      chart.timeScale().fitContent();
    },
    updateCandle(candle) {
      if (!candle) return;
      series.update(candle);
    },
  };
}

export function createAdminControlChart(container) {
  if (!window.LightweightCharts || !container) return null;
  const chart = window.LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background: { color: '#0d1428' }, textColor: '#f7f9ff' },
    grid: { vertLines: { color: '#1f2b48' }, horzLines: { color: '#1f2b48' } },
    rightPriceScale: { borderColor: '#2b3a60' },
    timeScale: { borderColor: '#2b3a60', rightOffset: 2 },
  });

  const priceSeries = chart.addLineSeries({ color: '#ffd84d', lineWidth: 2, title: 'Price' });
  const fairValueSeries = chart.addLineSeries({ color: '#ff4d4d', lineWidth: 2, title: 'Fair Value' });

  return {
    setInitialCandles(candles, fairValue) {
      if (!Array.isArray(candles) || !candles.length) return;
      const priceData = candles.map((c) => ({ time: c.time, value: Number(c.close) || 0 }));
      priceSeries.setData(priceData);

      const fair = Number(fairValue);
      if (Number.isFinite(fair)) {
        fairValueSeries.setData(candles.map((c) => ({ time: c.time, value: fair })));
      }

      chart.timeScale().fitContent();
    },
    updateValues({ time, price, fairValue }) {
      if (typeof time === 'undefined') return;
      const parsedPrice = Number(price);
      if (Number.isFinite(parsedPrice)) {
        priceSeries.update({ time, value: parsedPrice });
      }
      const parsedFair = Number(fairValue);
      if (Number.isFinite(parsedFair)) {
        fairValueSeries.update({ time, value: parsedFair });
      }
    },
  };
}

export function createHashrateLineChart(container) {
  if (!container) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 800 220');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '220');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0'); bg.setAttribute('width', '800'); bg.setAttribute('height', '220'); bg.setAttribute('fill', '#0d1428');
  const totalPath = document.createElementNS(NS, 'path');
  const basePath = document.createElementNS(NS, 'path');
  const playerPath = document.createElementNS(NS, 'path');
  [basePath, playerPath, totalPath].forEach((p) => { p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '2'); svg.appendChild(p); });
  basePath.setAttribute('stroke', '#5db2ff');
  playerPath.setAttribute('stroke', '#9b7bff');
  totalPath.setAttribute('stroke', '#32d296');
  svg.prepend(bg);
  container.innerHTML = '';
  container.appendChild(svg);

  const toPath = (points, min, max) => {
    if (!points.length) return '';
    const w = 780;
    const h = 180;
    const ox = 10;
    const oy = 20;
    return points.map((p, i) => {
      const x = ox + (i / Math.max(1, points.length - 1)) * w;
      const y = oy + h - (((p - min) / Math.max(1e-9, max - min)) * h);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  };

  return {
    update(points) {
      const rows = Array.isArray(points) ? points : [];
      if (!rows.length) {
        basePath.setAttribute('d', '');
        playerPath.setAttribute('d', '');
        totalPath.setAttribute('d', '');
        return;
      }
      const all = rows.flatMap((r) => [Number(r.baseNetworkHashrateTHs) || 0, Number(r.playerNetworkHashrateTHs) || 0, Number(r.totalNetworkHashrateTHs) || 0]);
      const min = Math.min(...all);
      const max = Math.max(...all);
      basePath.setAttribute('d', toPath(rows.map((r) => Number(r.baseNetworkHashrateTHs) || 0), min, max));
      playerPath.setAttribute('d', toPath(rows.map((r) => Number(r.playerNetworkHashrateTHs) || 0), min, max));
      totalPath.setAttribute('d', toPath(rows.map((r) => Number(r.totalNetworkHashrateTHs) || 0), min, max));
    },
  };
}
