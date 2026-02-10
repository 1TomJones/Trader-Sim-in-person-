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
  const priceLineSeries = chart.addLineSeries({ color: '#ffd84d', lineWidth: 2, crosshairMarkerVisible: false, priceLineVisible: false });
  const fairValueSeries = chart.addLineSeries({ color: '#ff4d4d', lineWidth: 2, crosshairMarkerVisible: false, priceLineVisible: false });
  let latestFairValue = null;
  let latestCandleTime = null;
  let candleTimes = [];

  const updatePriceLine = (candle) => {
    if (!candle || typeof candle.time === 'undefined') return;
    const close = Number(candle.close);
    if (!Number.isFinite(close)) return;
    latestCandleTime = candle.time;
    priceLineSeries.update({ time: candle.time, value: close });
  };

  return {
    setInitialCandles(candles) {
      if (!Array.isArray(candles) || !candles.length) return;
      series.setData(candles);
      candleTimes = candles.map((c) => c.time);
      latestCandleTime = candleTimes.length ? candleTimes[candleTimes.length - 1] : latestCandleTime;
      priceLineSeries.setData(candles.map((c) => ({ time: c.time, value: Number(c.close) || 0 })));
      if (latestFairValue !== null) {
        fairValueSeries.setData(candleTimes.map((time) => ({ time, value: latestFairValue })));
      }
      chart.timeScale().fitContent();
    },
    updateCandle(candle) {
      if (!candle) return;
      series.update(candle);
      updatePriceLine(candle);
      if (latestFairValue !== null && typeof candle.time !== 'undefined') {
        fairValueSeries.update({ time: candle.time, value: latestFairValue });
      }
    },
    updateFairValue(fairValue) {
      const parsed = Number(fairValue);
      if (!Number.isFinite(parsed)) return;
      latestFairValue = parsed;
      if (candleTimes.length) {
        fairValueSeries.setData(candleTimes.map((time) => ({ time, value: latestFairValue })));
      } else if (latestCandleTime !== null) {
        fairValueSeries.update({ time: latestCandleTime, value: latestFairValue });
      }
    },
  };
}
