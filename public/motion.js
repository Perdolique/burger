const NS = 'http://www.w3.org/2000/svg';
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function element(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function animate(duration, draw, complete = () => {}, delay = 0) {
  if (reducedMotion()) { draw(1); complete(); return () => {}; }
  const start = performance.now() + delay;
  let frame;
  let cancelled = false;
  function tick(now) {
    if (cancelled) return;
    const progress = Math.max(0, Math.min(1, (now - start) / duration));
    draw(progress);
    if (progress < 1) frame = requestAnimationFrame(tick); else complete();
  }
  draw(0);
  frame = requestAnimationFrame(tick);
  return () => { cancelled = true; cancelAnimationFrame(frame); };
}

const ease = value => value * value * (3 - 2 * value);
let clipId = 0;
function crop(svg, bounds) {
  const id = `motion-clip-${++clipId}`;
  const definition = element('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  const rectangle = element('rect', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  definition.append(rectangle);
  svg.querySelector('defs').append(definition);
  const group = element('g', { 'clip-path': `url(#${id})` });
  return { group, rectangle, definition };
}

export function textSlot(svg, options) {
  const window = crop(svg, options);
  svg.append(window.group);
  window.group.dataset.label = options.name;
  let value = '';
  let style = {};
  let cancel = () => {};
  function create(text, appearance) {
    const node = element('text', {
      x: options.align === 'end' ? options.x + options.width : options.x,
      y: options.baseline, 'font-size': appearance.size ?? options.size,
      'font-weight': appearance.weight ?? options.weight ?? 800,
      fill: appearance.color ?? options.color ?? '#26201A',
      'text-anchor': options.align === 'end' ? 'end' : 'start',
    });
    node.textContent = text;
    window.group.append(node);
    if (node.getComputedTextLength() > options.width && options.minSize) {
      const size = Math.max(options.minSize, (appearance.size ?? options.size) * options.width / node.getComputedTextLength());
      node.setAttribute('font-size', String(size));
    }
    if (node.getComputedTextLength() > options.width) {
      let shortened = text;
      while (shortened.length > 1 && node.getComputedTextLength() > options.width) {
        shortened = shortened.slice(0, -1); node.textContent = `${shortened}…`;
      }
    }
    return node;
  }
  return {
    set(next, appearance = {}, instant = false) {
      next = String(next);
      if (next === value && JSON.stringify(style) === JSON.stringify(appearance) && !instant) return;
      cancel(); window.group.replaceChildren();
      const before = value;
      const oldStyle = style;
      value = next; style = appearance;
      window.group.dataset.value = next;
      if (!before || instant || reducedMotion()) { create(next, appearance); return; }
      const old = create(before, oldStyle);
      const current = create(next, appearance);
      cancel = animate(450, progress => {
        const t = ease(progress);
        old.setAttribute('transform', `translate(0,${-t * (options.height + 2)})`);
        current.setAttribute('transform', `translate(0,${(1 - t) * (options.height + 2)})`);
      }, () => { old.remove(); current.removeAttribute('transform'); });
    },
    refit() { this.set(value, style, true); },
  };
}

function positions(value, count, options) {
  const width = character => options.size * (character === '.' ? 0.22 : character === '%' ? 0.8 : 0.6);
  const actualWidth = Array.from(value).reduce((sum, char) => sum + width(char), 0);
  let x = options.center !== undefined ? options.center - actualWidth / 2 : options.right - actualWidth;
  x -= (count - value.length) * options.size * 0.6;
  return Array.from(value.padStart(count, ' '), char => {
    const advance = width(char); const center = x + advance / 2; x += advance;
    return { char, center, width: advance };
  });
}

export function numberSlot(svg, options) {
  const window = crop(svg, options);
  svg.append(window.group);
  window.group.dataset.counter = options.name;
  let value = '';
  let cancel = () => {};
  let definitions = [];
  function clear() {
    window.group.replaceChildren();
    for (const definition of definitions) definition.remove();
    definitions = [];
  }
  function glyph(position) {
    const mask = crop(svg, { x: position.center - position.width / 2, y: options.y, width: position.width, height: options.height });
    definitions.push(mask.definition);
    const text = element('text', { x: position.center, y: options.baseline,
      'font-size': options.size, 'font-weight': 900, 'text-anchor': 'middle', fill: '#26201A' });
    text.textContent = position.char;
    mask.group.append(text); window.group.append(mask.group);
    return text;
  }
  function settled() {
    clear();
    for (const position of positions(value, value.length, options)) glyph(position);
  }
  return {
    set(next) {
      next = String(next);
      if (next === value) return;
      cancel();
      const before = value;
      value = next; window.group.dataset.value = next;
      if (!before || reducedMotion()) { settled(); return; }
      clear();
      const count = Math.max(before.length, next.length);
      const old = positions(before, count, options);
      const current = positions(next, count, options);
      const columns = current.map((position, index) => ({
        before: glyph(old[index]), after: glyph(position),
        same: old[index].char === position.char && Math.abs(old[index].center - position.center) < 0.01,
      }));
      cancel = animate(600, progress => {
        columns.forEach((column, index) => {
          const delay = Math.min(280, (count - 1 - index) * 70);
          const t = ease(Math.max(0, Math.min(1, (progress * 600 - delay) / (600 - delay))));
          column.before.setAttribute('y', String(options.baseline - (column.same ? 0 : t * options.height)));
          column.after.setAttribute('y', String(options.baseline + (1 - t) * options.height));
          column.before.style.display = !column.same && t >= 1 ? 'none' : '';
          column.after.style.display = column.same || t <= 0 ? 'none' : '';
        });
        window.group.dataset.progress = String(progress);
      }, settled);
    },
  };
}
