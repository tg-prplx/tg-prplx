#!/usr/bin/env node

import { exec, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DEFAULTS = {
  width: 1200,
  height: 630,
  theme: {
    accent: '#A855F7',
    accent2: '#46E3FF',
    text: '#FFFFFF',
    muted: '#D9C8FF',
    panel: '#111111'
  }
};

function usage() {
  return [
    'Usage:',
    '  node scripts/generate-profile-svg.js --image path/to/photo.png --config profile.config.json --out dist/profile.svg',
    '  node scripts/generate-profile-svg.js --image path/to/photo.png --vectorizer "tool {input} {output}" --config profile.config.json --out dist/profile.svg',
    '  node scripts/generate-profile-svg.js --background path/to/bg.svg --config profile.config.json --out dist/profile.svg',
    '',
    'Options:',
    '  --image       Raster image input: PNG, JPG, JPEG, WebP, GIF',
    '  --background  Already-converted SVG background',
    '  --vectorizer  Optional command template. Use {input} and {output} placeholders',
    '  --config      JSON profile config',
    '  --out         Output SVG path',
    '  --background-out  Optional path for the pure vectorized background SVG',
    '  --width       Override output width',
    '  --height      Override output height'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    args[key.slice(2)] = value;
    index += 1;
  }

  if ((!args.image && !args.background) || !args.config || !args.out) {
    throw new Error(`Missing required options.\n\n${usage()}`);
  }

  if (args.image && args.background) {
    throw new Error('Use either --image or --background, not both.');
  }

  return args;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeAttr(value) {
  return escapeXml(value);
}

function stripXmlPreamble(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!doctype[\s\S]*?>/i, '')
    .trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function imageDimensions(filePath) {
  try {
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
    const width = Number(stdout.match(/pixelWidth:\s*([0-9]+)/)?.[1]);
    const height = Number(stdout.match(/pixelHeight:\s*([0-9]+)/)?.[1]);

    if (width > 0 && height > 0) {
      return { width, height };
    }
  } catch {
    // Fall through to config-sized wrapper when sips cannot read the image.
  }

  return null;
}

function quantizeChannel(value, levels) {
  if (levels >= 256) {
    return value;
  }

  const step = 255 / Math.max(1, levels - 1);
  return Math.round(Math.round(value / step) * step);
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

async function rasterToPng(filePath) {
  const absolute = path.resolve(filePath);
  const ext = path.extname(absolute).toLowerCase();

  if (ext === '.png') {
    return absolute;
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'profile-svg-raster-'));
  const outputPath = path.join(tempRoot, 'input.png');
  await execFileAsync('sips', ['-s', 'format', 'png', absolute, '--out', outputPath]);
  return outputPath;
}

function samplePngToVectorSvg(png, options) {
  const cellSize = Math.max(4, Number(options.cellSize ?? 10));
  const colorLevels = Math.max(2, Math.min(256, Number(options.colors ?? 56)));
  const opacity = Math.max(0.05, Math.min(1, Number(options.opacity ?? 1)));
  const overlap = Math.max(0, Math.min(cellSize / 2, Number(options.overlap ?? 0.45)));
  const channelLevels = Math.max(2, Math.min(256, Number(options.channelLevels ?? Math.round(Math.cbrt(colorLevels)))));
  const smooth = Boolean(options.smooth);
  const blur = Math.max(0, Math.min(12, Number(options.blur ?? 0)));
  const columns = Math.ceil(png.width / cellSize);
  const rows = Math.ceil(png.height / cellSize);
  const rects = [];

  for (let row = 0; row < rows; row += 1) {
    const y0 = row * cellSize;
    const y1 = Math.min(png.height, y0 + cellSize);
    let run = null;

    for (let column = 0; column < columns; column += 1) {
      const x0 = column * cellSize;
      const x1 = Math.min(png.width, x0 + cellSize);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (png.width * y + x) << 2;
          const alpha = png.data[index + 3] / 255;
          r += png.data[index] * alpha;
          g += png.data[index + 1] * alpha;
          b += png.data[index + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const alphaAverage = a / count;
      const divisor = Math.max(0.0001, a);
      const color = rgbToHex(
        quantizeChannel(Math.round(r / divisor), channelLevels),
        quantizeChannel(Math.round(g / divisor), channelLevels),
        quantizeChannel(Math.round(b / divisor), channelLevels)
      );
      const fillOpacity = Number((alphaAverage * opacity).toFixed(3));

      if (run && run.color === color && run.opacity === fillOpacity) {
        run.width += x1 - x0;
      } else {
        if (run) {
          rects.push(run);
        }

        run = {
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          color,
          opacity: fillOpacity
        };
      }
    }

    if (run) {
      rects.push(run);
    }
  }

  const body = rects.map((item) => {
    const width = Math.min(png.width - item.x, item.width + overlap);
    const height = Math.min(png.height - item.y, item.height + overlap);
    const opacityAttr = item.opacity < 0.999 ? ` fill-opacity="${item.opacity}"` : '';
    return `<rect x="${item.x}" y="${item.y}" width="${width}" height="${height}" fill="${item.color}"${opacityAttr}/>`;
  }).join('\n  ');

  const defs = smooth && blur > 0
    ? `<defs>
    <filter id="smoothRaster" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
  </defs>
  `
    : '';
  const openGroup = smooth && blur > 0 ? '<g filter="url(#smoothRaster)">' : '<g>';
  const shapeRendering = smooth ? 'geometricPrecision' : 'crispEdges';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${png.width} ${png.height}" width="${png.width}" height="${png.height}" shape-rendering="${shapeRendering}">
  ${defs}${openGroup}
  ${body}
  </g>
</svg>`;
}

async function rasterToPureSvg(filePath, vectorizeOptions) {
  const pngPath = await rasterToPng(filePath);
  const png = PNG.sync.read(await readFile(pngPath));
  return samplePngToVectorSvg(png, vectorizeOptions ?? {});
}

async function vectorizeRaster(filePath, template) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'profile-svg-bg-'));
  const outputPath = path.join(tempRoot, 'background.svg');
  const absoluteInput = path.resolve(filePath);
  const command = template.includes('{input}') || template.includes('{output}')
    ? template
      .replaceAll('{input}', shellQuote(absoluteInput))
      .replaceAll('{output}', shellQuote(outputPath))
    : `${template} ${shellQuote(absoluteInput)} ${shellQuote(outputPath)}`;

  await execAsync(command, { maxBuffer: 1024 * 1024 * 64 });
  return readFile(outputPath, 'utf8');
}

async function loadBackgroundSvg(args, config) {
  if (args.background) {
    return readFile(path.resolve(args.background), 'utf8');
  }

  if (args.vectorizer) {
    return vectorizeRaster(args.image, args.vectorizer);
  }

  return rasterToPureSvg(args.image, config.vectorize);
}

function extractSvg(svg) {
  const clean = stripXmlPreamble(svg);
  const openMatch = clean.match(/<svg\b([^>]*)>/i);
  const closeIndex = clean.toLowerCase().lastIndexOf('</svg>');

  if (!openMatch || closeIndex === -1) {
    throw new Error('Background file is not a valid SVG document.');
  }

  const attrs = openMatch[1] ?? '';
  const inner = clean.slice(openMatch.index + openMatch[0].length, closeIndex);
  const viewBoxMatch = attrs.match(/\bviewBox=["']([^"']+)["']/i);
  const widthMatch = attrs.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i);
  const heightMatch = attrs.match(/\bheight=["']([0-9.]+)(?:px)?["']/i);

  return {
    inner,
    viewBox: viewBoxMatch?.[1],
    width: widthMatch ? Number(widthMatch[1]) : undefined,
    height: heightMatch ? Number(heightMatch[1]) : undefined
  };
}

function backgroundLayer(backgroundSvg, width, height) {
  const parsed = extractSvg(backgroundSvg);
  const viewBox = parsed.viewBox
    ?? `0 0 ${parsed.width || width} ${parsed.height || height}`;

  return [
    '<g class="background-welcome">',
    `<svg class="background-art" x="-24" y="-18" width="${width + 48}" height="${height + 36}" viewBox="${escapeAttr(viewBox)}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`,
    parsed.inner,
    '</svg>',
    '</g>'
  ].join('\n');
}

function text(textValue, attrs = {}) {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(' ');

  return `<text ${attrText}>${escapeXml(textValue)}</text>`;
}

function rect(attrs = {}) {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(' ');

  return `<rect ${attrText}/>`;
}

function pill({ x, y, label, value, fill, textColor = '#FFFFFF', width }) {
  const badgeWidth = width ?? Math.max(164, (label.length + String(value).length) * 12 + 56);
  const labelWidth = Math.max(78, label.length * 11 + 28);

  return [
    `<g class="pill badge-pop" transform="translate(${x} ${y})">`,
    rect({ x: 0, y: 0, width: badgeWidth, height: 38, rx: 7, fill: 'url(#badgeShell)', stroke: '#ffffff', 'stroke-opacity': 0.1 }),
    rect({ x: 11, y: 9, width: 3, height: 20, rx: 1.5, fill, 'fill-opacity': 0.9 }),
    rect({ x: labelWidth, y: 0, width: badgeWidth - labelWidth, height: 38, rx: 7, fill, 'fill-opacity': 0.92, class: 'badge-accent' }),
    rect({ x: labelWidth, y: 0, width: 7, height: 38, fill, 'fill-opacity': 0.92, class: 'badge-accent' }),
    text(label, { x: labelWidth / 2 + 4, y: 25, 'text-anchor': 'middle', class: 'badge-label' }),
    text(value, { x: labelWidth + (badgeWidth - labelWidth) / 2, y: 25, 'text-anchor': 'middle', fill: textColor, class: 'badge-value' }),
    '</g>'
  ].join('\n');
}

function skillPill({ x, y, label }) {
  const width = Math.max(96, label.length * 10 + 34);
  const skillColors = {
    Python: '#46E3FF',
    JavaScript: '#FACC15',
    Linux: '#A855F7',
    'LLM API': '#22C55E'
  };
  const color = skillColors[label] ?? '#46E3FF';

  return [
    `<g transform="translate(${x} ${y})">`,
    rect({ x: 0, y: 0, width, height: 30, rx: 6, fill: 'url(#chipShell)', stroke: '#ffffff', 'stroke-opacity': 0.1, class: 'skill-bg' }),
    rect({ x: 11, y: 11, width: 8, height: 8, rx: 4, fill: color, 'fill-opacity': 0.88 }),
    text(label, { x: width / 2 + 6, y: 20, 'text-anchor': 'middle', class: 'skill-label' }),
    '</g>'
  ].join('\n');
}

function contactPill({ x, y, label }) {
  const width = Math.max(132, label.length * 11 + 52);

  return [
    `<g transform="translate(${x} ${y})">`,
    rect({ x: 0, y: 0, width, height: 38, rx: 7, fill: 'url(#contactFill)', stroke: '#ffffff', 'stroke-opacity': 0.13, class: 'contact-bg' }),
    rect({ x: 1, y: 1, width: width - 2, height: 15, rx: 6, fill: '#ffffff', 'fill-opacity': 0.12 }),
    '<path class="telegram-icon" transform="translate(15 7) scale(1.05)" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.28-.9-.88.18-1.3l15.97-6.16c.73-.27 1.38.18 1.15 1.25l-2.72 12.82c-.19.91-.74 1.13-1.5.7l-4.17-3.07-2.01 1.93c-.22.22-.41.41-.76.48Z" fill="#ffffff"/>',
    text(label, { x: width / 2 + 13, y: 27, 'text-anchor': 'middle', class: 'contact-label' }),
    '</g>'
  ].join('\n');
}

function layoutRow(items, startX, y, gap, render) {
  let cursor = startX;

  return items.map((item) => {
    const output = render(item, cursor, y);
    cursor += output.width + gap;
    return output.svg;
  }).join('\n');
}

const BACKGROUND_WELCOME_DURATION = 1.9;
const CONTENT_START_DELAY = BACKGROUND_WELCOME_DURATION + 0.18;
const TYPE_START_DELAY = CONTENT_START_DELAY + 0.28;
const TYPE_LINE_STAGGER = 1;
const TYPE_DURATION = 0.95;
const TERMINAL_CHAR_WIDTH = 13.2;

function formatSeconds(value) {
  return `${Number(value.toFixed(2))}s`;
}

function formatNumber(value) {
  return String(Number(value.toFixed(2)));
}

function typingDoneDelay(lines) {
  const visibleCount = Math.min(lines.length, 4);

  if (visibleCount === 0) {
    return TYPE_START_DELAY;
  }

  return TYPE_START_DELAY + (visibleCount - 1) * TYPE_LINE_STAGGER + TYPE_DURATION;
}

function typingCursor({ chars, delaySeconds, distance, doneDelay, isLastLine, x, y }) {
  const stepDuration = TYPE_DURATION / chars;
  const cursorStepDuration = stepDuration * 0.9;
  const charWidth = distance / chars;
  const cursorY = y - 21;
  const stepCount = isLastLine ? chars : chars + 1;
  const steps = Array.from({ length: stepCount }, (_, index) => {
    return `<rect x="${formatNumber(x + index * charWidth)}" y="${cursorY}" width="3.5" height="24" rx="1.75" class="cursor-step" style="--cursor-step-delay: ${formatSeconds(delaySeconds + index * stepDuration)}; --cursor-step-duration: ${formatSeconds(cursorStepDuration)};"/>`;
  });
  const blink = isLastLine
    ? `<rect x="${formatNumber(x + distance)}" y="${cursorY}" width="3.5" height="24" rx="1.75" class="cursor-blink" style="--blink-delay: ${formatSeconds(doneDelay)};"/>`
    : '';

  return [...steps, blink].filter(Boolean).join('\n');
}

function renderTypingLines(lines, theme) {
  const visibleLines = lines.slice(0, 4);
  const startY = 228;
  const doneDelay = typingDoneDelay(visibleLines);

  return [
    `<g class="terminal-shell fade-up" style="animation-delay: ${formatSeconds(CONTENT_START_DELAY + 0.12)};" filter="url(#glassShadow)">`,
    rect({ x: 258, y: 182, width: 684, height: 160, rx: 10, fill: 'url(#terminalFill)', stroke: 'url(#terminalStroke)', 'stroke-opacity': 0.52, class: 'terminal-panel' }),
    '</g>',
    ...visibleLines.map((line, index) => {
      const y = startY + index * 28;
      const delaySeconds = TYPE_START_DELAY + index * TYPE_LINE_STAGGER;
      const delay = formatSeconds(delaySeconds);
      const prefix = index === 0 ? '$' : '>';
      const content = `${prefix} ${line}`;
      const cursorDistance = Math.min(684, content.length * TERMINAL_CHAR_WIDTH);
      const cursorStart = 600 - cursorDistance / 2;
      const isLastLine = index === visibleLines.length - 1;

      return [
        `<text x="600" y="${y}" text-anchor="middle" class="${index === 0 ? 'typing-line active-line typed' : 'typing-line typed'}" style="--type-delay: ${delay}; --type-duration: ${formatSeconds(TYPE_DURATION)}; --chars: ${content.length};">${escapeXml(content)}</text>`,
        typingCursor({
          chars: content.length,
          delaySeconds,
          distance: cursorDistance,
          doneDelay,
          isLastLine,
          x: cursorStart,
          y
        })
      ].join('\n');
    })
  ].join('\n');
}

function renderProfile(config, backgroundSvg) {
  const width = Number(config.width ?? DEFAULTS.width);
  const height = Number(config.height ?? DEFAULTS.height);
  const outputWidth = Number(config.outputWidth ?? width);
  const outputHeight = Number(config.outputHeight ?? height);
  const theme = { ...DEFAULTS.theme, ...(config.theme ?? {}) };
  const profile = config.profile ?? {};
  const projects = profile.projects ?? [];
  const skills = profile.skills ?? [];
  const contacts = profile.contacts ?? [];
  const title = profile.name ?? 'prplx';
  const description = profile.description ?? '';
  const typingLines = profile.typingLines ?? [];
  const tagline = profile.tagline ?? '';
  const terminalDone = typingDoneDelay(typingLines);
  const revealStart = terminalDone + 0.25;
  const titleDelay = formatSeconds(CONTENT_START_DELAY);
  const taglineDelay = formatSeconds(revealStart + 0.15);
  const skillsDelay = formatSeconds(revealStart + 0.3);
  const contactsDelay = formatSeconds(revealStart + 0.45);

  const projectTotal = projects.reduce((sum, project) => {
    const label = project.label ?? '';
    const value = project.value ?? '';
    return sum + Math.max(190, (label.length + String(value).length) * 11 + 64);
  }, 0) + Math.max(0, projects.length - 1) * 16;

  const projectBadges = layoutRow(projects, 600 - projectTotal / 2, 364, 16, (project, x, y) => {
    const label = project.label ?? '';
    const value = project.value ?? '';
    const widthValue = Math.max(190, (label.length + String(value).length) * 11 + 64);

    return {
      width: widthValue,
      svg: pill({
        x,
        y,
        label,
        value,
        fill: project.color ?? theme.accent,
        width: widthValue,
        textColor: project.textColor ?? '#FFFFFF'
      })
    };
  });

  const skillStart = 600 - ((skills.reduce((sum, item) => sum + Math.max(96, item.length * 10 + 34), 0) + Math.max(0, skills.length - 1) * 12) / 2);
  const skillPills = layoutRow(skills, skillStart, 460, 12, (label, x, y) => {
    const widthValue = Math.max(96, label.length * 10 + 34);

    return {
      width: widthValue,
      svg: skillPill({ x, y, label })
    };
  });

  const contactStart = 600 - ((contacts.reduce((sum, item) => sum + Math.max(132, item.length * 11 + 52), 0) + Math.max(0, contacts.length - 1) * 16) / 2);
  const contactPills = layoutRow(contacts, contactStart, 516, 16, (label, x, y) => {
    const widthValue = Math.max(132, label.length * 11 + 52);

    return {
      width: widthValue,
      svg: contactPill({ x, y, label })
    };
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)} GitHub profile banner</title>
  <desc id="desc">${escapeXml(tagline || description)}</desc>
  <defs>
    <clipPath id="frameClip">
      <rect x="0" y="0" width="${width}" height="${height}" rx="12"/>
    </clipPath>
    <linearGradient id="panelFade" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#09070D" stop-opacity="0.2"/>
      <stop offset="0.48" stop-color="#0C0912" stop-opacity="0.48"/>
      <stop offset="1" stop-color="#050407" stop-opacity="0.84"/>
    </linearGradient>
    <radialGradient id="stageLight" cx="50%" cy="29%" r="62%">
      <stop offset="0" stop-color="${escapeXml(theme.accent)}" stop-opacity="0.14"/>
      <stop offset="0.42" stop-color="${escapeXml(theme.accent2)}" stop-opacity="0.055"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="terminalFill" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#121019" stop-opacity="0.72"/>
      <stop offset="0.55" stop-color="#09080D" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#06060A" stop-opacity="0.78"/>
    </linearGradient>
    <linearGradient id="terminalStroke" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.5" stop-color="${escapeXml(theme.accent)}"/>
      <stop offset="1" stop-color="${escapeXml(theme.accent2)}"/>
    </linearGradient>
    <linearGradient id="accentLine" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${escapeXml(theme.accent)}" stop-opacity="0"/>
      <stop offset="0.25" stop-color="${escapeXml(theme.accent)}" stop-opacity="0.78"/>
      <stop offset="0.75" stop-color="${escapeXml(theme.accent2)}" stop-opacity="0.78"/>
      <stop offset="1" stop-color="${escapeXml(theme.accent2)}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="badgeShell" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111018" stop-opacity="0.92"/>
      <stop offset="1" stop-color="#07070A" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="chipShell" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#101017" stop-opacity="0.88"/>
      <stop offset="1" stop-color="#07070A" stop-opacity="0.82"/>
    </linearGradient>
    <linearGradient id="contactFill" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#34D6FF"/>
      <stop offset="1" stop-color="#1684DD"/>
    </linearGradient>
    <filter id="titleGlow" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#000000" flood-opacity="0.32"/>
      <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="${escapeXml(theme.accent)}" flood-opacity="0.12"/>
    </filter>
    <filter id="glassShadow" x="-8%" y="-24%" width="116%" height="148%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020106" flood-opacity="0.38"/>
    </filter>
    <filter id="softShadow" x="-12%" y="-35%" width="124%" height="170%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#020106" flood-opacity="0.34"/>
    </filter>
    <style>
      @keyframes fadeUp {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes bgDrift {
        0% { transform: translate(-12px, -8px) scale(1.13); }
        28% { transform: translate(10px, -2px) scale(1.145); }
        58% { transform: translate(6px, 10px) scale(1.135); }
        82% { transform: translate(-10px, 6px) scale(1.15); }
        100% { transform: translate(-12px, -8px) scale(1.13); }
      }
      @keyframes bgWelcome {
        from { transform: rotate(0deg) scale(1); opacity: 0.82; }
        to { transform: rotate(5deg) scale(1.12); opacity: 1; }
      }
      @keyframes ambientPulse {
        0%, 100% { opacity: 0.82; transform: translateY(0) scale(1); }
        45% { opacity: 1; transform: translateY(-4px) scale(1.01); }
        72% { opacity: 0.9; transform: translateY(3px) scale(1.006); }
      }
      @keyframes lineFloatA {
        0%, 100% { transform: translate(-36px, 0); opacity: 0.06; }
        50% { transform: translate(34px, -8px); opacity: 0.15; }
      }
      @keyframes lineFloatB {
        0%, 100% { transform: translate(34px, 0); opacity: 0.065; }
        50% { transform: translate(-34px, 10px); opacity: 0.14; }
      }
      @keyframes lineFloatC {
        0%, 100% { transform: translate(-24px, 10px); opacity: 0.04; }
        50% { transform: translate(28px, -6px); opacity: 0.1; }
      }
      @keyframes typeIn {
        from { opacity: 0; clip-path: inset(0 100% 0 0); }
        5% { opacity: 1; }
        to { opacity: 1; clip-path: inset(0 0 0 0); }
      }
      @keyframes blink {
        0%, 45% { opacity: 1; }
        46%, 100% { opacity: 0; }
      }
      @keyframes cursorStep {
        from, to { opacity: 1; }
      }
      @keyframes panelIdle {
        0%, 100% { stroke-opacity: 0.25; fill-opacity: 0.5; }
        50% { stroke-opacity: 0.48; fill-opacity: 0.58; }
      }
      @keyframes accentIdle {
        0%, 100% { fill-opacity: 1; }
        50% { fill-opacity: 0.78; }
      }
      @keyframes skillIdle {
        0%, 100% { stroke-opacity: 0.12; fill-opacity: 0.86; }
        50% { stroke-opacity: 0.3; fill-opacity: 0.93; }
      }
      @keyframes contactIdle {
        0%, 100% { fill-opacity: 0.92; }
        50% { fill-opacity: 1; }
      }
      @keyframes textIdle {
        0%, 100% { fill-opacity: 1; }
        50% { fill-opacity: 0.82; }
      }
      .background-welcome { animation: bgWelcome ${formatSeconds(BACKGROUND_WELCOME_DURATION)} cubic-bezier(0.2, 0.9, 0.18, 1) both; transform-origin: 50% 50%; will-change: transform; }
      .background-art { animation: bgDrift 18s ease-in-out ${formatSeconds(BACKGROUND_WELCOME_DURATION)} infinite; transform-origin: 50% 50%; will-change: transform; }
      .ambient-light { opacity: 0; animation: ambientPulse 9s ease-in-out ${formatSeconds(CONTENT_START_DELAY)} infinite; transform-origin: 50% 35%; }
      .line-a { opacity: 0; animation: lineFloatA 12s ease-in-out ${formatSeconds(CONTENT_START_DELAY)} infinite; }
      .line-b { opacity: 0; animation: lineFloatB 14s ease-in-out ${formatSeconds(CONTENT_START_DELAY)} infinite; }
      .line-c { opacity: 0; animation: lineFloatC 16s ease-in-out ${formatSeconds(CONTENT_START_DELAY + 0.35)} infinite; }
      .fade-up { animation: fadeUp 0.8s ease-out both; }
      .badge-pop { animation: fadeUp 0.7s ease-out both; animation-delay: ${formatSeconds(revealStart)}; }
      .typed { animation: typeIn var(--type-duration, 1.2s) steps(var(--chars), end) both; animation-delay: var(--type-delay, 0s); }
      .cursor-step { fill: ${escapeXml(theme.accent2)}; opacity: 0; animation: cursorStep var(--cursor-step-duration, 0.16s) linear var(--cursor-step-delay, 0s) 1; }
      .cursor-blink { fill: ${escapeXml(theme.accent2)}; opacity: 0; animation: blink 0.85s steps(1, end) var(--blink-delay, 4s) infinite; }
      .terminal-panel { animation: panelIdle 5.6s ease-in-out ${formatSeconds(terminalDone + 0.35)} infinite; }
      .badge-accent { animation: accentIdle 4.8s ease-in-out ${formatSeconds(revealStart + 0.4)} infinite; }
      .skill-bg { animation: skillIdle 6s ease-in-out ${formatSeconds(revealStart + 0.55)} infinite; }
      .contact-bg { animation: contactIdle 5.2s ease-in-out ${formatSeconds(revealStart + 0.7)} infinite; }
      .title { font: 820 74px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${escapeXml(theme.text)}; letter-spacing: 0; filter: url(#titleGlow); }
      .desc { font: 600 21px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${escapeXml(theme.muted)}; letter-spacing: 0; filter: url(#titleGlow); }
      .typing-line { font: 500 22px "JetBrains Mono", "SFMono-Regular", Consolas, monospace; fill: #F1EBFF; letter-spacing: 0; }
      .active-line { fill: ${escapeXml(theme.accent)}; animation-name: typeIn, textIdle; animation-duration: var(--type-duration, 1.2s), 5s; animation-timing-function: steps(var(--chars), end), ease-in-out; animation-delay: var(--type-delay, 0s), ${formatSeconds(terminalDone + 0.55)}; animation-iteration-count: 1, infinite; animation-fill-mode: both, none; }
      .tagline { font: 600 21px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${escapeXml(theme.text)}; letter-spacing: 0; }
      .badge-label { font: 700 15px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #ffffff; letter-spacing: 0; }
      .badge-value { font: 800 16px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
      .skill-label { font: 700 13px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #ffffff; letter-spacing: 0; }
      .contact-label { font: 800 16px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #ffffff; letter-spacing: 0; }
    </style>
  </defs>

  <g clip-path="url(#frameClip)">
    ${backgroundLayer(backgroundSvg, width, height)}
    <rect width="${width}" height="${height}" fill="url(#panelFade)"/>
    <rect class="ambient-light" width="${width}" height="${height}" fill="url(#stageLight)"/>
    <g class="stripe-field">
      <path class="line-a" d="M92 126 C280 48 420 164 602 94 S910 46 1120 132" fill="none" stroke="${escapeXml(theme.accent2)}" stroke-opacity="0.14" stroke-width="1"/>
      <path class="line-b" d="M82 548 C306 496 468 560 648 508 S884 476 1128 536" fill="none" stroke="${escapeXml(theme.accent)}" stroke-opacity="0.13" stroke-width="1"/>
      <path class="line-c" d="M58 398 C234 356 404 420 594 382 S908 336 1142 388" fill="none" stroke="#ffffff" stroke-opacity="0.075" stroke-width="1"/>
    </g>
    <rect x="34" y="34" width="${width - 68}" height="${height - 68}" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.055"/>

    <g text-anchor="middle">
      <g class="fade-up" style="animation-delay: ${titleDelay};">
        ${text(title, { x: 600, y: 136, class: 'title' })}
        ${text(description, { x: 600, y: 174, class: 'desc' })}
        ${rect({ x: 548, y: 188, width: 104, height: 2, rx: 1, fill: 'url(#accentLine)' })}
      </g>
      ${renderTypingLines(typingLines, theme)}
      ${projectBadges}
      <g class="fade-up" style="animation-delay: ${taglineDelay};">${text(tagline, { x: 600, y: 438, class: 'tagline' })}</g>
      <g class="fade-up" style="animation-delay: ${skillsDelay};">${skillPills}</g>
      <g class="fade-up" style="animation-delay: ${contactsDelay};">${contactPills}</g>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="#9A9AA4" stroke-opacity="0.76" stroke-width="1"/>
</svg>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const outPath = path.resolve(args.out);
  const config = JSON.parse(await readFile(configPath, 'utf8'));

  if (args.width) {
    config.width = Number(args.width);
  }

  if (args.height) {
    config.height = Number(args.height);
  }

  const backgroundSvg = await loadBackgroundSvg(args, config);

  if (args['background-out']) {
    const backgroundOutPath = path.resolve(args['background-out']);
    await mkdir(path.dirname(backgroundOutPath), { recursive: true });
    await writeFile(backgroundOutPath, backgroundSvg, 'utf8');
  }

  const output = renderProfile(config, backgroundSvg);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, output, 'utf8');
  console.log(`Generated ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
