// Maps a price series onto SVG polyline points inside a 72x22 viewbox.
export function sparklinePoints(values: number[], width = 72, height = 22, pad = 2) {
  const points = values.filter((value) => Number.isFinite(value) && value > 0);
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || max * 0.001 || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  return points
    .map((value, index) => `${(pad + index * stepX).toFixed(1)},${(height - pad - ((value - min) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
}
