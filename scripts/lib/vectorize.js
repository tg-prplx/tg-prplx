// Raster -> pure SVG mosaic.
//
// Pipeline:
//   1. average the image into a grid of cells (alpha-aware)
//   2. reduce the cell colors to a small palette (median cut, weighted)
//   3. merge equal neighbours into rectangles: horizontal runs, then vertical
//   4. emit ONE <path> per palette color, coordinates in cell units
//
// Step 4 is where most of the size goes away: a rect costs ~14 bytes
// ("M12 40h9v3h-9z") instead of ~70 for a <rect .../> with a fill attribute.
// The whole mosaic is blurred with feGaussianBlur, so the coarse grid and
// limited palette read as a smooth image.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';

const execFileAsync = promisify(execFile);

export const VECTORIZE_DEFAULTS = {
  cellSize: 8,
  colors: 96,
  blur: 0.9,
  saturation: 1,
  brightness: 1
};

function hex(value) {
  return value.toString(16).padStart(2, '0');
}

function toHex([r, g, b]) {
  const full = `${hex(r)}${hex(g)}${hex(b)}`;
  if (full[0] === full[1] && full[2] === full[3] && full[4] === full[5]) {
    return `#${full[0]}${full[2]}${full[4]}`;
  }
  return `#${full}`;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function adjustColor([r, g, b], saturation, brightness) {
  if (saturation === 1 && brightness === 1) {
    return [r, g, b];
  }
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    clampByte((luma + (r - luma) * saturation) * brightness),
    clampByte((luma + (g - luma) * saturation) * brightness),
    clampByte((luma + (b - luma) * saturation) * brightness)
  ];
}

function sampleGrid(png, cellSize, saturation, brightness) {
  const columns = Math.ceil(png.width / cellSize);
  const rows = Math.ceil(png.height / cellSize);
  const cells = new Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    const y0 = row * cellSize;
    const y1 = Math.min(png.height, y0 + cellSize);

    for (let column = 0; column < columns; column += 1) {
      const x0 = column * cellSize;
      const x1 = Math.min(png.width, x0 + cellSize);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (png.width * y + x) << 2;
          const alpha = png.data[index + 3] / 255;
          r += png.data[index] * alpha;
          g += png.data[index + 1] * alpha;
          b += png.data[index + 2] * alpha;
          a += alpha;
        }
      }

      const divisor = Math.max(0.0001, a);
      cells[row * columns + column] = adjustColor([r / divisor, g / divisor, b / divisor], saturation, brightness);
    }
  }

  return { cells, columns, rows };
}

// Median cut over the cell colors. Boxes are split along their widest
// channel at the median; the box with the largest (range * population) goes
// first so big smooth areas and small saturated details both get colors.
function medianCut(colors, target) {
  if (colors.length === 0) {
    return [[0, 0, 0]];
  }

  const makeBox = (items) => {
    const min = [255, 255, 255];
    const max = [0, 0, 0];
    for (const color of items) {
      for (let channel = 0; channel < 3; channel += 1) {
        if (color[channel] < min[channel]) min[channel] = color[channel];
        if (color[channel] > max[channel]) max[channel] = color[channel];
      }
    }
    const ranges = [0, 1, 2].map((channel) => max[channel] - min[channel]);
    const channel = ranges.indexOf(Math.max(...ranges));
    return { items, channel, score: ranges[channel] * Math.sqrt(items.length) };
  };

  const boxes = [makeBox(colors)];

  while (boxes.length < target) {
    boxes.sort((left, right) => right.score - left.score);
    const box = boxes[0];
    if (box.items.length < 2 || box.score === 0) {
      break;
    }
    const sorted = [...box.items].sort((left, right) => left[box.channel] - right[box.channel]);
    const middle = sorted.length >> 1;
    boxes.splice(0, 1, makeBox(sorted.slice(0, middle)), makeBox(sorted.slice(middle)));
  }

  return boxes.map(({ items }) => {
    const sum = [0, 0, 0];
    for (const color of items) {
      sum[0] += color[0];
      sum[1] += color[1];
      sum[2] += color[2];
    }
    return sum.map((value) => clampByte(value / items.length));
  });
}

function nearestIndex(palette, color, cache) {
  const key = (color[0] << 16) | (color[1] << 8) | color[2];
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const entry = palette[index];
    // Weighted RGB distance: close enough to perceptual for a blurred mosaic.
    const dr = entry[0] - color[0];
    const dg = entry[1] - color[1];
    const db = entry[2] - color[2];
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }

  cache.set(key, best);
  return best;
}

// Greedy rectangle merge: runs per row, then stack identical runs vertically.
function mergeRects(indices, columns, rows) {
  const done = [];
  let open = new Map();

  for (let row = 0; row < rows; row += 1) {
    const next = new Map();
    let column = 0;

    while (column < columns) {
      const color = indices[row * columns + column];
      let end = column + 1;
      while (end < columns && indices[row * columns + end] === color) {
        end += 1;
      }

      const key = `${column},${end - column},${color}`;
      const existing = open.get(key);
      if (existing) {
        existing.h += 1;
        open.delete(key);
        next.set(key, existing);
      } else {
        next.set(key, { x: column, y: row, w: end - column, h: 1, color });
      }
      column = end;
    }

    for (const rect of open.values()) {
      done.push(rect);
    }
    open = next;
  }

  for (const rect of open.values()) {
    done.push(rect);
  }
  return done;
}

function pathData(rects) {
  rects.sort((left, right) => left.y - right.y || left.x - right.x);
  let out = '';
  let lastX = 0;
  let lastY = 0;
  let first = true;

  for (const { x, y, w, h } of rects) {
    const absolute = `M${x} ${y}`;
    const dx = x - lastX;
    const dy = y - lastY;
    const relative = `m${dx}${dy < 0 ? '' : ' '}${dy}`;
    const move = first || absolute.length <= relative.length ? absolute : relative;
    out += `${move}h${w}v${h}h-${w}z`;
    lastX = x;
    lastY = y;
    first = false;
  }

  return out;
}

export function vectorizePng(png, options = {}) {
  const settings = { ...VECTORIZE_DEFAULTS, ...options };
  const cellSize = Math.max(1, Math.round(Number(settings.cellSize)));
  const paletteSize = Math.max(2, Math.min(512, Math.round(Number(settings.colors))));
  const blur = Math.max(0, Number(settings.blur));
  const { cells, columns, rows } = sampleGrid(
    png,
    cellSize,
    Number(settings.saturation),
    Number(settings.brightness)
  );

  const palette = medianCut(cells, paletteSize);
  const cache = new Map();
  const indices = new Uint16Array(cells.length);
  const usage = new Array(palette.length).fill(0);

  for (let index = 0; index < cells.length; index += 1) {
    const color = cells[index].map(clampByte);
    indices[index] = nearestIndex(palette, color, cache);
    usage[indices[index]] += 1;
  }

  // The most used color becomes the backdrop rect; its cells are skipped.
  const backdrop = usage.indexOf(Math.max(...usage));
  const groups = new Map();
  for (const rect of mergeRects(indices, columns, rows)) {
    if (rect.color === backdrop) {
      continue;
    }
    if (!groups.has(rect.color)) {
      groups.set(rect.color, []);
    }
    groups.get(rect.color).push(rect);
  }

  const paths = [...groups.entries()]
    .sort((left, right) => usage[right[0]] - usage[left[0]])
    .map(([color, rects]) => `<path fill="${toHex(palette[color])}" d="${pathData(rects)}"/>`);

  const rectCount = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
  const filter = blur > 0
    ? `<defs><filter id="mosaicBlur" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur}" edgeMode="duplicate"/></filter></defs>`
    : '';
  const group = blur > 0 ? '<g filter="url(#mosaicBlur)">' : '<g>';

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${rows}" width="${png.width}" height="${png.height}" shape-rendering="crispEdges" preserveAspectRatio="none">`,
    filter,
    group,
    `<rect width="${columns}" height="${rows}" fill="${toHex(palette[backdrop])}"/>`,
    ...paths,
    '</g>',
    '</svg>'
  ].join('');

  return { svg, stats: { columns, rows, colors: groups.size + 1, rects: rectCount + 1, bytes: Buffer.byteLength(svg) } };
}

async function convertToPng(filePath) {
  const absolute = path.resolve(filePath);
  if (path.extname(absolute).toLowerCase() === '.png') {
    return absolute;
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'profile-svg-raster-'));
  const outputPath = path.join(tempRoot, 'input.png');
  const attempts = [
    ['sips', ['-s', 'format', 'png', absolute, '--out', outputPath]],
    ['magick', [absolute, outputPath]],
    ['convert', [absolute, outputPath]]
  ];

  for (const [command, args] of attempts) {
    try {
      await execFileAsync(command, args);
      return outputPath;
    } catch {
      // Try the next converter.
    }
  }

  throw new Error(`Cannot convert ${filePath} to PNG: install ImageMagick (magick) or pass a .png file.`);
}

export async function vectorizeFile(filePath, options) {
  const pngPath = await convertToPng(filePath);
  const png = PNG.sync.read(await readFile(pngPath));
  return vectorizePng(png, options);
}
