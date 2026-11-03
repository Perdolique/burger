import { animate, element, reducedMotion } from './motion.js';

function polygons(path) {
  return path.split(/M/i).filter(Boolean).map(section => {
    const coordinates = (section.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    return Array.from({ length: coordinates.length / 2 }, (_, index) => coordinates.slice(index * 2, index * 2 + 2));
  }).filter(points => points.length >= 3);
}

function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

export function interiorPoint(parts) {
  const area = polygon => Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length]; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0));
  const polygon = parts.slice().sort((a, b) => area(b) - area(a))[0];
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  let best = polygon[0], bestDistance = -1;
  for (let row = 1; row < 25; row++) for (let column = 1; column < 25; column++) {
    const point = [minX + width * column / 25, minY + height * row / 25];
    if (!inside(point, polygon)) continue;
    const distance = Math.min(...polygon.map((a, i) => distanceToSegment(point, a, polygon[(i + 1) % polygon.length])));
    if (distance > bestDistance) { best = point; bestDistance = distance; }
  }
  return best;
}

export function tether(origin, destination, parts) {
  if (parts.some(polygon => inside(origin, polygon))) return null;
  const direction = [destination[0] - origin[0], destination[1] - origin[1]];
  const length = Math.hypot(...direction);
  if (length < 7) return null;
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  let best = Infinity;
  for (const polygon of parts) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const edge = [b[0] - a[0], b[1] - a[1]], offset = [a[0] - origin[0], a[1] - origin[1]];
    const divisor = cross(direction, edge);
    if (Math.abs(divisor) < 0.000001) continue;
    const ray = cross(offset, edge) / divisor, segment = cross(offset, direction) / divisor;
    if (ray > 0 && ray <= 1 && segment >= 0 && segment <= 1) best = Math.min(best, ray);
  }
  if (!Number.isFinite(best) || best * length <= 7) return null;
  return { start: origin.map((value, i) => value + direction[i] * 5.1 / length),
    end: origin.map((value, i) => value + direction[i] * best) };
}

export function calloutLayout({ parts, bounds, x, y, anchor }) {
  const origin = [anchor[0] + x, anchor[1] + y];
  for (const maxWidth of [100, 92, 84]) {
    const scale = Math.min(maxWidth / bounds.width, 92 / bounds.height);
    const width = bounds.width * scale, height = bounds.height * scale;
    let best = null;
    for (const left of [8, (200 - width) / 2, 192 - width]) {
      for (const top of [7, (122 - height) / 2, 115 - height]) {
        const tx = left - bounds.x * scale, ty = top - bounds.y * scale;
        const projected = parts.map(polygon => polygon.map(point => [point[0] * scale + tx, point[1] * scale + ty]));
        const line = tether(origin, [anchor[0] * scale + tx, anchor[1] * scale + ty], projected);
        if (!line) continue;
        const distance = Math.hypot(line.end[0] - origin[0], line.end[1] - origin[1]);
        if (!best || distance > best.distance) best = { scale, x: tx, y: ty, distance };
      }
    }
    if (best) return best;
  }
  return { scale: 1, x, y };
}

export class MapView {
  constructor(svg) {
    this.root = svg.querySelector('#map-focus');
    this.states = new Map([...svg.querySelectorAll('[data-state]')].map(group => [group.dataset.state, group]));
    this.geometry = new Map();
    this.active = null;
    this.cancel = () => {};
  }

  set(state, color) {
    if (this.active && this.active.state === state) {
      this.active.shape.setAttribute('fill', color);
      this.active.dot.setAttribute('fill', color);
      this.states.get(state)?.querySelector('path').setAttribute('fill', color);
      return;
    }
    this.cancel();
    if (this.active) {
      this.states.get(this.active.state)?.querySelector('path').setAttribute('fill', '#E9DFC9');
      const previous = this.active.group;
      animate(450, t => { previous.style.opacity = String(1 - t); }, () => previous.remove());
    }
    const original = this.states.get(state);
    if (!original) { this.active = null; return; }
    const source = original.querySelector('path');
    source.setAttribute('fill', color);
    let geometry = this.geometry.get(state);
    if (!geometry) {
      const parts = polygons(source.getAttribute('d'));
      const bounds = source.getBBox();
      const translation = original.transform.baseVal.consolidate().matrix;
      geometry = { parts, bounds, x: translation.e, y: translation.f, anchor: interiorPoint(parts) };
      this.geometry.set(state, geometry);
    }
    const { parts, bounds, x, y, anchor } = geometry;
    const layout = calloutLayout(geometry);
    const scale = layout.scale, targetX = layout.x, targetY = layout.y;
    const origin = [anchor[0] + x, anchor[1] + y];
    const group = element('g', { 'data-enlarged-state': state });
    const halo = element('path', { d: source.getAttribute('d'), fill: '#FFF4DD', stroke: '#FFF4DD', 'stroke-linejoin': 'round' });
    const line = element('path', { fill: 'none', stroke: '#26201A', 'stroke-width': 1.8, 'stroke-linecap': 'round' });
    const shape = element('path', { d: source.getAttribute('d'), fill: color, stroke: '#26201A', 'stroke-linejoin': 'round' });
    const dotHalo = element('circle', { cx: origin[0], cy: origin[1], r: 5.4, fill: '#FFF4DD' });
    const dot = element('circle', { cx: origin[0], cy: origin[1], r: 3.4, fill: color, stroke: '#26201A', 'stroke-width': 1.2 });
    group.append(halo, line, shape, dotHalo, dot); this.root.append(group);
    this.active = { state, group, shape, dot };
    this.cancel = animate(450, progress => {
      const t = 1 - (1 - progress) ** 3;
      const s = 1 + (scale - 1) * t, tx = x + (targetX - x) * t, ty = y + (targetY - y) * t;
      for (const node of [halo, shape]) node.setAttribute('transform', `translate(${tx},${ty}) scale(${s})`);
      halo.setAttribute('stroke-width', String(7 / s)); shape.setAttribute('stroke-width', String(1.7 / s));
      const projected = parts.map(polygon => polygon.map(point => [point[0] * s + tx, point[1] * s + ty]));
      const segment = tether(origin, [anchor[0] * s + tx, anchor[1] * s + ty], projected);
      line.style.display = segment ? '' : 'none';
      if (segment) line.setAttribute('d', `M${segment.start.join(',')}L${segment.end.join(',')}`);
      group.dataset.progress = String(progress);
    }, () => {}, reducedMotion() ? 0 : 180);
  }
}
