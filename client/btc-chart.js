export function createBtcCandleChart(container) {
  if (!window.LightweightCharts || !container) return null;
  const chart = window.LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background: { color: '#0d1428' }, textColor: '#f7f9ff' },
    grid: { vertLines: { color: '#1f2b48' }, horzLines: { color: '#1f2b48' } },
    rightPriceScale: { borderColor: '#2b3a60' },
    timeScale: { borderColor: '#2b3a60', rightOffset: 2 },
  });
  const series = chart.addCandlestickSeries({ upColor: '#32d296', downColor: '#ff6b6b', borderUpColor: '#32d296', borderDownColor: '#ff6b6b', wickUpColor: '#32d296', wickDownColor: '#ff6b6b' });

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
