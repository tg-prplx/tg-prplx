#!/usr/bin/env node

import { exec } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { vectorizeFile } from './lib/vectorize.js';

const execAsync = promisify(exec);

const DEFAULTS = {
  width: 1200,
  height: 630,
  theme: {
    accent: '#A855F7',
    accent2: '#46E3FF',
    text: '#FFFFFF',
    muted: '#D9C8FF',
    panel: '#111111'
  },
  effects: {
    particles: 26,
    scanlines: true,
    vignette: true,
    borderGlow: true,
    titleShimmer: true,
    terminalChrome: true
  },
  terminal: {
    title: '',
    maxLines: 4
  }
};

const SKILL_COLORS = {
  python: '#46E3FF',
  javascript: '#FACC15',
  typescript: '#3B82F6',
  linux: '#A855F7',
  'llm api': '#22C55E',
  rust: '#F97316',
  go: '#22D3EE',
  'c++': '#60A5FA',
  c: '#94A3B8',
  react: '#38BDF8',
  'node.js': '#4ADE80',
  docker: '#0EA5E9',
  bash: '#A3E635',
  lua: '#818CF8',
  swift: '#FB923C',
  kotlin: '#C084FC'
};

const CONTACT_STYLES = {
  telegram: { from: '#34D6FF', to: '#1684DD' },
  github: { from: '#3A3F4B', to: '#16181D' },
  email: { from: '#C084FC', to: '#7C3AED' },
  web: { from: '#2DD4BF', to: '#0F766E' },
  discord: { from: '#818CF8', to: '#4F46E5' }
};

const CONTACT_ICONS = {
  telegram: '<path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.28-.9-.88.18-1.3l15.97-6.16c.73-.27 1.38.18 1.15 1.25l-2.72 12.82c-.19.91-.74 1.13-1.5.7l-4.17-3.07-2.01 1.93c-.22.22-.41.41-.76.48Z" fill="#fff"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  email: '<rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M3.5 7l8.5 6 8.5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  web: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M2.5 12h19M12 2.5c2.8 2.6 4 6 4 9.5s-1.2 6.9-4 9.5c-2.8-2.6-4-6-4-9.5s1.2-6.9 4-9.5Z" fill="none" stroke="#fff" stroke-width="2"/>',
  discord: '<path d="M8 7.5c2.6-.9 5.4-.9 8 0M7.5 16.5c2.9 1.2 6.1 1.2 9 0M8.2 6.8 6.5 5C4.6 5.6 3.4 6.4 2.5 8 1.6 10.8 1.4 13.7 2 16.6c1.4 1.3 2.9 2 4.5 2.4l1-1.9m8.3-11.3L17.5 5c1.9.6 3.1 1.4 4 3 .9 2.8 1.1 5.7.5 8.6-1.4 1.3-2.9 2-4.5 2.4l-1-1.9" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="12.5" r="1.5" fill="#fff"/><circle cx="15" cy="12.5" r="1.5" fill="#fff"/>'
};

const SANS = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const MONO_ADVANCE = 0.6;

const BACKGROUND_WELCOME_DURATION = 1.9;
const CONTENT_START_DELAY = BACKGROUND_WELCOME_DURATION + 0.18;
const TYPE_START_DELAY = CONTENT_START_DELAY + 0.4;
const TYPE_LINE_STAGGER = 1;
const TYPE_DURATION = 0.95;

function usage() {
  return [
    'Usage:',
    '  node scripts/generate-profile-svg.js --image photo.jpg --config profile.config.json --out dist/profile.svg',
    '  node scripts/generate-profile-svg.js --background bg.svg --config profile.config.json --out dist/profile.svg',
    '',
    'Options:',
    '  --image           Raster background (PNG directly; JPG/WebP/GIF via sips or ImageMagick)',
    '  --background      Already-vectorized SVG background',
    '  --vectorizer      External raster->SVG command template with {input} and {output}',
    '  --config          JSON profile config',
    '  --out             Output SVG path',
    '  --background-out  Also write the pure vectorized background SVG here',
    '  --width/--height  Override the canvas size',
    '  --help            Show this message'
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }

  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
  }

  if ((!args.image && !args.background) || !args.config || !args.out) {
    throw new Error(`Missing required options.\n\n${usage()}`);
  }
  if (args.image && args.background) {
    throw new Error('Use either --image or --background, not both.');
  }
  return args;
}

// ---------------------------------------------------------------- helpers

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function attrs(input) {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ');
}

const el = (name, attributes = {}, children = '') => {
  const open = `<${name} ${attrs(attributes)}`.trimEnd();
  return children === '' ? `${open}/>` : `${open}>${children}</${name}>`;
};

const n = (value) => String(Number(value.toFixed(2)));
const s = (value) => `${n(value)}s`;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Deterministic PRNG so CI rebuilds don't produce noisy diffs.
function seededRandom(seedText) {
  let seed = 2166136261;
  for (const char of String(seedText)) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  }
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Approximate advance widths (in em) for a bold UI sans. Fonts are not
// embedded (GitHub's <img> sandbox can't load them), so widths are estimated
// slightly generously and text is left-aligned inside pills.
function textWidth(value, size) {
  let em = 0;
  for (const char of String(value)) {
    if (char === ' ') em += 0.28;
    else if ("iIl.,:;'|!j·".includes(char)) em += 0.3;
    else if ('frt()-[]/'.includes(char)) em += 0.42;
    else if ('mwMW@%★'.includes(char)) em += 0.92;
    else if (/[A-Z]/.test(char)) em += 0.72;
    else if (/[0-9]/.test(char)) em += 0.63;
    else em += 0.6;
  }
  return em * size;
}

function normalizeSkill(skill) {
  const item = typeof skill === 'string' ? { label: skill } : skill;
  return {
    label: item.label,
    color: item.color ?? SKILL_COLORS[String(item.label).toLowerCase()] ?? '#46E3FF'
  };
}

function normalizeContact(contact) {
  const item = typeof contact === 'string' ? { label: contact } : contact;
  let type = item.type;
  if (!type) {
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item.label)) type = 'email';
    else if (/^https?:\/\//.test(item.label)) type = 'web';
    else type = 'telegram';
  }
  return { type: CONTACT_ICONS[type] ? type : 'web', label: item.label };
}

// ------------------------------------------------------------- background

async function vectorizeExternal(filePath, template) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'profile-svg-bg-'));
  const outputPath = path.join(tempRoot, 'background.svg');
  const input = shellQuote(path.resolve(filePath));
  const output = shellQuote(outputPath);
  const command = template.includes('{input}') || template.includes('{output}')
    ? template.replaceAll('{input}', input).replaceAll('{output}', output)
    : `${template} ${input} ${output}`;
  await execAsync(command, { maxBuffer: 1024 * 1024 * 64 });
  return readFile(outputPath, 'utf8');
}

async function loadBackgroundSvg(args, config) {
  if (args.background) {
    return readFile(path.resolve(args.background), 'utf8');
  }
  if (args.vectorizer) {
    return vectorizeExternal(args.image, args.vectorizer);
  }
  const { svg, stats } = await vectorizeFile(args.image, config.vectorize);
  console.log(`Vectorized ${stats.columns}x${stats.rows} grid -> ${stats.rects} rects, ${stats.colors} colors, ${(stats.bytes / 1024).toFixed(1)} KB`);
  return svg;
}

function extractSvg(svg) {
  const clean = svg.replace(/<\?xml[\s\S]*?\?>/i, '').replace(/<!doctype[\s\S]*?>/i, '').trim();
  const openMatch = clean.match(/<svg\b([^>]*)>/i);
  const closeIndex = clean.toLowerCase().lastIndexOf('</svg>');
  if (!openMatch || closeIndex === -1) {
    throw new Error('Background file is not a valid SVG document.');
  }
  const svgAttrs = openMatch[1] ?? '';
  const number = (name) => Number(svgAttrs.match(new RegExp(`\\b${name}=["']([0-9.]+)(?:px)?["']`, 'i'))?.[1]) || undefined;
  return {
    inner: clean.slice(openMatch.index + openMatch[0].length, closeIndex),
    viewBox: svgAttrs.match(/\bviewBox=["']([^"']+)["']/i)?.[1],
    width: number('width'),
    height: number('height')
  };
}

function backgroundLayer(backgroundSvg, width, height) {
  const parsed = extractSvg(backgroundSvg);
  const viewBox = parsed.viewBox ?? `0 0 ${parsed.width || width} ${parsed.height || height}`;
  // Transforms go on <g> wrappers: CSS transforms on a nested <svg> are not
  // reliable across browsers.
  // Generous overscan: the welcome rotation + drift must never expose a corner.
  const padX = Math.round(width * 0.08);
  const padY = Math.round(height * 0.12);
  return `<g class="background-welcome"><g class="background-art"><svg x="${-padX}" y="${-padY}" width="${width + padX * 2}" height="${height + padY * 2}" viewBox="${escapeXml(viewBox)}" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${parsed.inner}</svg></g></g>`;
}

// ----------------------------------------------------------------- blocks

function projectBadge({ x, y, label, value, color, textColor }) {
  const labelWidth = Math.ceil(textWidth(label, 15) + 42);
  const valueWidth = Math.ceil(Math.max(56, textWidth(value, 16) + 30));
  const width = labelWidth + valueWidth;
  const svg = [
    `<g transform="translate(${n(x)} ${y})">`,
    el('rect', { width, height: 38, rx: 8, fill: 'url(#badgeShell)', stroke: '#fff', 'stroke-opacity': 0.12 }),
    el('rect', { x: 12, y: 10, width: 3, height: 18, rx: 1.5, fill: color }),
    el('path', { d: `M${labelWidth} 0h${valueWidth - 8}a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8h-${valueWidth - 8}z`, fill: color, class: 'badge-accent' }),
    el('path', { d: `M${labelWidth} 1h${valueWidth - 9}a7 7 0 0 1 7 7v8h-${valueWidth - 2}z`, fill: '#fff', 'fill-opacity': 0.14 }),
    el('text', { x: 25, y: 24.5, class: 'badge-label' }, escapeXml(label)),
    el('text', { x: labelWidth + valueWidth / 2, y: 24.5, 'text-anchor': 'middle', fill: textColor, class: 'badge-value' }, escapeXml(value)),
    '</g>'
  ].join('');
  return { width, svg };
}

function skillChip({ x, y, label, color }) {
  const width = Math.ceil(textWidth(label, 13) + 46);
  const svg = [
    `<g transform="translate(${n(x)} ${y})">`,
    el('rect', { width, height: 30, rx: 7, fill: 'url(#chipShell)', stroke: '#fff', 'stroke-opacity': 0.12, class: 'skill-bg' }),
    el('circle', { cx: 16, cy: 15, r: 4, fill: color }),
    el('circle', { cx: 16, cy: 15, r: 7, fill: color, 'fill-opacity': 0.18 }),
    el('text', { x: 29, y: 19.5, class: 'skill-label' }, escapeXml(label)),
    '</g>'
  ].join('');
  return { width, svg };
}

function contactPill({ x, y, label, type }) {
  const width = Math.ceil(textWidth(label, 16) + 64);
  const svg = [
    `<g transform="translate(${n(x)} ${y})">`,
    el('rect', { width, height: 38, rx: 8, fill: `url(#contact-${type})`, stroke: '#fff', 'stroke-opacity': 0.16, class: 'contact-bg' }),
    el('rect', { x: 1, y: 1, width: width - 2, height: 16, rx: 7, fill: '#fff', 'fill-opacity': 0.12 }),
    `<g transform="translate(14 8) scale(0.92)">${CONTACT_ICONS[type]}</g>`,
    el('text', { x: 46, y: 25, class: 'contact-label' }, escapeXml(label)),
    '</g>'
  ].join('');
  return { width, svg };
}

function centeredRow(items, centerX, y, gap, render) {
  const rendered = [];
  for (const item of items) {
    rendered.push(render(item, 0, y));
  }
  const total = rendered.reduce((sum, item) => sum + item.width, 0) + Math.max(0, items.length - 1) * gap;
  let cursor = centerX - total / 2;
  return items.map((item) => {
    const output = render(item, cursor, y);
    cursor += output.width + gap;
    return output.svg;
  }).join('');
}

function typingDoneDelay(count) {
  return count === 0 ? TYPE_START_DELAY : TYPE_START_DELAY + (count - 1) * TYPE_LINE_STAGGER + TYPE_DURATION;
}

function terminalBlock({ lines, centerX, top, width, theme, chrome, title }) {
  const charsMax = Math.max(1, ...lines.map((line) => line.length + 2));
  const padX = 30;
  const fontSize = Math.min(22, (width - padX * 2) / charsMax / MONO_ADVANCE);
  const charWidth = fontSize * MONO_ADVANCE;
  const chromeHeight = chrome ? 34 : 0;
  const lineGap = Math.round(fontSize * 1.3);
  const firstBaseline = top + chromeHeight + 20 + fontSize;
  const lastBaseline = firstBaseline + (lines.length - 1) * lineGap;
  const height = lastBaseline + 22 - top;
  const left = centerX - width / 2;
  const textX = left + padX;
  const doneDelay = typingDoneDelay(lines.length);
  const shellDelay = s(CONTENT_START_DELAY + 0.12);
  const parts = [];

  parts.push(`<g class="fade-up" style="animation-delay:${shellDelay}">`);
  parts.push(`<g filter="url(#glassShadow)">${el('rect', { x: n(left), y: top, width, height, rx: 12, fill: 'url(#terminalFill)', stroke: 'url(#terminalStroke)', 'stroke-opacity': 0.5, class: 'terminal-panel' })}</g>`);

  if (chrome) {
    const dotsY = top + chromeHeight / 2;
    parts.push(el('path', { d: `M${n(left + 1)} ${top + chromeHeight}h${width - 2}`, stroke: '#fff', 'stroke-opacity': 0.08 }));
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((color, index) => {
      parts.push(el('circle', { cx: n(left + 22 + index * 20), cy: dotsY, r: 6, fill: color, 'fill-opacity': 0.9 }));
    });
    if (title) {
      parts.push(el('text', { x: centerX, y: dotsY + 4.5, 'text-anchor': 'middle', class: 'terminal-title' }, escapeXml(title)));
    }
  }
  parts.push('</g>');

  lines.forEach((line, index) => {
    const baseline = firstBaseline + index * lineGap;
    const delay = TYPE_START_DELAY + index * TYPE_LINE_STAGGER;
    const prompt = index === 0 ? '$' : '›';
    const chars = line.length + 2;
    const length = chars * charWidth;
    const isLast = index === lines.length - 1;
    const classes = index === 0 ? 'typing-line typed active-line' : 'typing-line typed';

    // textLength pins the line to the monospace grid even when the viewer
    // falls back to a different mono font, so cursor and reveal stay aligned.
    parts.push(el('text', {
      x: n(textX),
      y: baseline,
      class: classes,
      textLength: n(length),
      lengthAdjust: 'spacingAndGlyphs',
      style: `--type-delay:${s(delay)};--type-duration:${s(TYPE_DURATION)};--chars:${chars};font-size:${n(fontSize)}px`
    }, `<tspan class="${index === 0 ? 'prompt' : 'prompt-out'}">${prompt}</tspan> ${escapeXml(line)}`));

    const step = TYPE_DURATION / chars;
    const cursorTop = baseline - fontSize * 0.95;
    const cursorHeight = fontSize * 1.1;
    const stepCount = isLast ? chars : chars + 1;
    for (let char = 0; char < stepCount; char += 1) {
      parts.push(el('rect', {
        x: n(textX + char * charWidth),
        y: n(cursorTop),
        width: 3.5,
        height: n(cursorHeight),
        rx: 1.75,
        class: 'cursor-step',
        style: `--cursor-step-delay:${s(delay + char * step)};--cursor-step-duration:${s(step * 0.9)}`
      }));
    }
    if (isLast) {
      parts.push(el('rect', {
        x: n(textX + length + 2),
        y: n(cursorTop),
        width: n(charWidth * 0.62),
        height: n(cursorHeight),
        rx: 1.5,
        class: 'cursor-blink',
        style: `--blink-delay:${s(doneDelay)}`
      }));
    }
  });

  return { svg: parts.join(''), height };
}

function particlesLayer(count, width, height, theme, seed) {
  if (!count) return '';
  const random = seededRandom(seed);
  const colors = [theme.accent, theme.accent2, '#FFFFFF', theme.muted];
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const x = 50 + random() * (width - 100);
    const y = 80 + random() * (height - 120);
    const r = 0.8 + random() * 1.8;
    const duration = 7 + random() * 9;
    const delay = CONTENT_START_DELAY + random() * duration;
    const variant = 'abc'[index % 3];
    items.push(el('circle', {
      cx: n(x),
      cy: n(y),
      r: n(r),
      fill: colors[index % colors.length],
      'fill-opacity': n(0.45 + random() * 0.45),
      class: `particle p-${variant}`,
      style: `animation-duration:${s(duration)};animation-delay:${s(delay)}`
    }));
  }
  return `<g class="particles">${items.join('')}</g>`;
}

function roundedRectPerimeter(width, height, radius) {
  return 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
}

// ----------------------------------------------------------------- render

function renderProfile(config, backgroundSvg) {
  const width = Number(config.width ?? DEFAULTS.width);
  const height = Number(config.height ?? DEFAULTS.height);
  const outputWidth = Number(config.outputWidth ?? width);
  const outputHeight = Number(config.outputHeight ?? height);
  const cx = width / 2;
  const theme = { ...DEFAULTS.theme, ...(config.theme ?? {}) };
  const effects = { ...DEFAULTS.effects, ...(config.effects ?? {}) };
  const terminal = { ...DEFAULTS.terminal, ...(config.terminal ?? {}) };
  const profile = config.profile ?? {};
  const title = profile.name ?? 'prplx';
  const description = profile.description ?? '';
  const tagline = profile.tagline ?? '';
  const lines = (profile.typingLines ?? []).slice(0, terminal.maxLines);
  const projects = profile.projects ?? [];
  const skills = (profile.skills ?? []).map(normalizeSkill);
  const contacts = (profile.contacts ?? []).map(normalizeContact);
  const contactTypes = [...new Set(contacts.map((item) => item.type))];
  const terminalWidth = Math.min(width - 240, 700);
  const t = (value) => escapeXml(theme[value]);

  // ---- vertical stack, measured first, then centered on the canvas
  const terminalProbe = lines.length
    ? terminalBlock({ lines, centerX: cx, top: 0, width: terminalWidth, theme, chrome: effects.terminalChrome, title: terminal.title })
    : { height: 0 };
  const layout = {};
  let y = 0;
  layout.title = y + 60;
  layout.desc = y + 96;
  layout.rule = y + 110;
  y += 116;
  if (lines.length) {
    y += 16;
    layout.terminal = y;
    y += terminalProbe.height;
  }
  if (projects.length) {
    y += 20;
    layout.projects = y;
    y += 38;
  }
  if (tagline) {
    y += 36;
    layout.tagline = y;
    y += 8;
  }
  if (skills.length) {
    y += 18;
    layout.skills = y;
    y += 30;
  }
  if (contacts.length) {
    y += 22;
    layout.contacts = y;
    y += 38;
  }
  const offset = Math.round((height - y) / 2);
  for (const key of Object.keys(layout)) {
    layout[key] += offset;
  }

  // ---- timing
  const terminalDone = typingDoneDelay(lines.length);
  const revealStart = lines.length ? terminalDone + 0.25 : CONTENT_START_DELAY + 0.6;
  const delays = {
    title: s(CONTENT_START_DELAY),
    projects: s(revealStart),
    tagline: s(revealStart + 0.15),
    skills: s(revealStart + 0.3),
    contacts: s(revealStart + 0.45)
  };

  // ---- blocks
  const terminalSvg = lines.length
    ? terminalBlock({ lines, centerX: cx, top: layout.terminal, width: terminalWidth, theme, chrome: effects.terminalChrome, title: terminal.title }).svg
    : '';
  const projectRow = centeredRow(projects, cx, layout.projects, 16, (project, x, rowY) => projectBadge({
    x,
    y: rowY,
    label: project.label ?? '',
    value: String(project.value ?? ''),
    color: project.color ?? theme.accent,
    textColor: project.textColor ?? '#FFFFFF'
  }));
  const skillRow = centeredRow(skills, cx, layout.skills, 12, (skill, x, rowY) => skillChip({ x, y: rowY, ...skill }));
  const contactRow = centeredRow(contacts, cx, layout.contacts, 16, (contact, x, rowY) => contactPill({ x, y: rowY, ...contact }));

  // ---- border comet
  const perimeter = roundedRectPerimeter(width - 1, height - 1, 12);
  const comet = 150;
  const cometGap = perimeter / 2 - comet;
  const borderGlow = effects.borderGlow
    ? [
      `<g class="border-comet" fill="none">`,
      el('rect', { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 12, stroke: 'url(#borderGradient)', 'stroke-width': 6, 'stroke-opacity': 0.35, 'stroke-dasharray': `${comet} ${n(cometGap)}`, filter: 'url(#cometGlow)', class: 'comet' }),
      el('rect', { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 12, stroke: 'url(#borderGradient)', 'stroke-width': 1.6, 'stroke-dasharray': `${comet} ${n(cometGap)}`, 'stroke-linecap': 'round', class: 'comet' }),
      '</g>'
    ].join('')
    : '';

  const titleFill = effects.titleShimmer ? 'url(#titleShine)' : t('text');
  const shimmerBegin = CONTENT_START_DELAY + 0.8;
  const contactGradients = contactTypes.map((type) => {
    const style = CONTACT_STYLES[type];
    return `<linearGradient id="contact-${type}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${style.from}"/><stop offset="1" stop-color="${style.to}"/></linearGradient>`;
  }).join('');

  const css = `
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes bgDrift{0%{transform:translate(-12px,-8px) scale(1.13)}28%{transform:translate(10px,-2px) scale(1.145)}58%{transform:translate(6px,10px) scale(1.135)}82%{transform:translate(-10px,6px) scale(1.15)}100%{transform:translate(-12px,-8px) scale(1.13)}}
@keyframes bgWelcome{from{transform:rotate(0deg) scale(1);opacity:.75}to{transform:rotate(5deg) scale(1.12);opacity:1}}
@keyframes ambientPulse{0%,100%{opacity:.8;transform:translateY(0) scale(1)}45%{opacity:1;transform:translateY(-4px) scale(1.01)}72%{opacity:.9;transform:translateY(3px) scale(1.006)}}
@keyframes lineFloatA{0%,100%{transform:translate(-36px,0);opacity:.06}50%{transform:translate(34px,-8px);opacity:.15}}
@keyframes lineFloatB{0%,100%{transform:translate(34px,0);opacity:.065}50%{transform:translate(-34px,10px);opacity:.14}}
@keyframes lineFloatC{0%,100%{transform:translate(-24px,10px);opacity:.04}50%{transform:translate(28px,-6px);opacity:.1}}
@keyframes typeIn{from{opacity:0;clip-path:inset(0 100% 0 0)}5%{opacity:1}to{opacity:1;clip-path:inset(0 0 0 0)}}
@keyframes blink{0%,45%{opacity:1}46%,100%{opacity:0}}
@keyframes cursorStep{from,to{opacity:1}}
@keyframes panelIdle{0%,100%{stroke-opacity:.28}50%{stroke-opacity:.55}}
@keyframes accentIdle{0%,100%{fill-opacity:1}50%{fill-opacity:.8}}
@keyframes skillIdle{0%,100%{stroke-opacity:.12}50%{stroke-opacity:.32}}
@keyframes textIdle{0%,100%{fill-opacity:1}50%{fill-opacity:.82}}
@keyframes comet{to{stroke-dashoffset:${n(-perimeter)}}}
@keyframes cometIn{from{opacity:0}to{opacity:1}}
@keyframes floatA{0%{transform:translate(0,0);opacity:0}20%,80%{opacity:1}100%{transform:translate(14px,-70px);opacity:0}}
@keyframes floatB{0%{transform:translate(0,0);opacity:0}20%,80%{opacity:1}100%{transform:translate(-18px,-56px);opacity:0}}
@keyframes floatC{0%{transform:translate(0,0);opacity:0}25%,75%{opacity:1}100%{transform:translate(6px,-90px);opacity:0}}
.background-welcome{animation:bgWelcome ${s(BACKGROUND_WELCOME_DURATION)} cubic-bezier(.2,.9,.18,1) both;transform-origin:50% 50%}
.background-art{animation:bgDrift 18s ease-in-out ${s(BACKGROUND_WELCOME_DURATION)} infinite backwards;transform-origin:50% 50%}
.ambient-light{opacity:0;animation:ambientPulse 9s ease-in-out ${s(CONTENT_START_DELAY)} infinite;transform-origin:50% 35%}
.line-a{opacity:0;animation:lineFloatA 12s ease-in-out ${s(CONTENT_START_DELAY)} infinite}
.line-b{opacity:0;animation:lineFloatB 14s ease-in-out ${s(CONTENT_START_DELAY)} infinite}
.line-c{opacity:0;animation:lineFloatC 16s ease-in-out ${s(CONTENT_START_DELAY + 0.35)} infinite}
.fade-up{animation:fadeUp .8s cubic-bezier(.2,.8,.2,1) both}
.typed{animation:typeIn var(--type-duration,1.2s) steps(var(--chars),end) both;animation-delay:var(--type-delay,0s)}
.cursor-step{fill:${t('accent2')};opacity:0;animation:cursorStep var(--cursor-step-duration,.16s) linear var(--cursor-step-delay,0s) 1}
.cursor-blink{fill:${t('accent2')};opacity:0;animation:blink .9s steps(1,end) var(--blink-delay,4s) infinite}
.terminal-panel{animation:panelIdle 5.6s ease-in-out ${s(terminalDone + 0.35)} infinite}
.badge-accent{animation:accentIdle 4.8s ease-in-out ${s(revealStart + 0.4)} infinite}
.skill-bg{animation:skillIdle 6s ease-in-out ${s(revealStart + 0.55)} infinite}
.comet{animation:comet 9s linear ${s(CONTENT_START_DELAY)} infinite}
.border-comet{opacity:0;animation:cometIn 1.2s ease-out ${s(CONTENT_START_DELAY)} both}
.particle{opacity:0;animation-timing-function:ease-in-out;animation-iteration-count:infinite;transform-box:fill-box}
.p-a{animation-name:floatA}.p-b{animation-name:floatB}.p-c{animation-name:floatC}
.title{font:820 74px ${SANS};fill:${titleFill};letter-spacing:-1px;filter:url(#titleGlow)}
.desc{font:600 21px ${SANS};fill:${t('muted')};filter:url(#titleGlow)}
.typing-line{font-family:${MONO};font-weight:500;fill:#F1EBFF}
.prompt{fill:${t('accent2')};font-weight:700}
.prompt-out{fill:${t('muted')};fill-opacity:.55}
.active-line{fill:${t('accent')};animation-name:typeIn,textIdle;animation-duration:var(--type-duration,1.2s),5s;animation-timing-function:steps(var(--chars),end),ease-in-out;animation-delay:var(--type-delay,0s),${s(terminalDone + 0.55)};animation-iteration-count:1,infinite;animation-fill-mode:both,none}
.terminal-title{font:500 13px ${MONO};fill:#fff;fill-opacity:.45}
.tagline{font:600 21px ${SANS};fill:${t('text')};filter:url(#titleGlow)}
.badge-label{font:700 15px ${SANS};fill:#fff}
.badge-value{font:800 16px ${SANS}}
.skill-label{font:700 13px ${SANS};fill:#fff}
.contact-label{font:800 16px ${SANS};fill:#fff}
@media (prefers-reduced-motion:reduce){
*{animation:none!important}
.cursor-step,.particle,.border-comet{display:none}
.cursor-blink{opacity:1}
.ambient-light{opacity:.9}
.background-welcome{transform:rotate(5deg) scale(1.12)}
}`.trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(title)} GitHub profile banner</title>
<desc id="desc">${escapeXml(tagline || description)}</desc>
<defs>
<clipPath id="frameClip"><rect width="${width}" height="${height}" rx="12"/></clipPath>
<linearGradient id="panelFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#09070D" stop-opacity=".22"/><stop offset=".48" stop-color="#0C0912" stop-opacity=".5"/><stop offset="1" stop-color="#050407" stop-opacity=".86"/></linearGradient>
<radialGradient id="vignette" cx="50%" cy="46%" r="72%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<radialGradient id="stageLight" cx="50%" cy="29%" r="62%"><stop offset="0" stop-color="${t('accent')}" stop-opacity=".16"/><stop offset=".42" stop-color="${t('accent2')}" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<pattern id="scanlines" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity=".28"/></pattern>
<linearGradient id="terminalFill" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#14111C" stop-opacity=".8"/><stop offset=".55" stop-color="#09080D" stop-opacity=".76"/><stop offset="1" stop-color="#06060A" stop-opacity=".84"/></linearGradient>
<linearGradient id="terminalStroke" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="${t('accent')}"/><stop offset="1" stop-color="${t('accent2')}"/></linearGradient>
<linearGradient id="accentLine" x1="0" x2="1"><stop offset="0" stop-color="${t('accent')}" stop-opacity="0"/><stop offset=".25" stop-color="${t('accent')}" stop-opacity=".85"/><stop offset=".75" stop-color="${t('accent2')}" stop-opacity=".85"/><stop offset="1" stop-color="${t('accent2')}" stop-opacity="0"/></linearGradient>
<linearGradient id="borderGradient" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${t('accent2')}"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="${t('accent')}"/></linearGradient>
<linearGradient id="titleShine" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="320" y2="0"><stop offset="0" stop-color="${t('text')}"/><stop offset=".4" stop-color="${t('text')}"/><stop offset=".48" stop-color="${t('accent2')}"/><stop offset=".56" stop-color="${t('accent')}"/><stop offset=".64" stop-color="${t('text')}"/><stop offset="1" stop-color="${t('text')}"/>${effects.titleShimmer ? `<animateTransform attributeName="gradientTransform" type="translate" values="-340 0;${width} 0;${width} 0" keyTimes="0;.32;1" dur="6s" begin="${s(shimmerBegin)}" repeatCount="indefinite"/>` : ''}</linearGradient>
<linearGradient id="badgeShell" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#14121C" stop-opacity=".94"/><stop offset="1" stop-color="#07070A" stop-opacity=".92"/></linearGradient>
<linearGradient id="chipShell" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#121119" stop-opacity=".9"/><stop offset="1" stop-color="#07070A" stop-opacity=".84"/></linearGradient>
${contactGradients}
<filter id="titleGlow" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#000" flood-opacity=".34"/><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${t('accent')}" flood-opacity=".18"/></filter>
<filter id="glassShadow" x="-8%" y="-24%" width="116%" height="148%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020106" flood-opacity=".42"/></filter>
<filter id="cometGlow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/></filter>
<style>
${css}
</style>
</defs>
<g clip-path="url(#frameClip)">
${backgroundLayer(backgroundSvg, width, height)}
<rect width="${width}" height="${height}" fill="url(#panelFade)"/>
${effects.vignette ? `<rect width="${width}" height="${height}" fill="url(#vignette)"/>` : ''}
${effects.scanlines ? `<rect width="${width}" height="${height}" fill="url(#scanlines)" opacity=".4"/>` : ''}
<rect class="ambient-light" width="${width}" height="${height}" fill="url(#stageLight)"/>
<g fill="none" stroke-width="1">
<path class="line-a" d="M92 126C280 48 420 164 602 94S910 46 1120 132" stroke="${t('accent2')}" stroke-opacity=".14" transform="scale(${n(width / 1200)} ${n(height / 630)})"/>
<path class="line-b" d="M82 548C306 496 468 560 648 508S884 476 1128 536" stroke="${t('accent')}" stroke-opacity=".13" transform="scale(${n(width / 1200)} ${n(height / 630)})"/>
<path class="line-c" d="M58 398C234 356 404 420 594 382S908 336 1142 388" stroke="#fff" stroke-opacity=".075" transform="scale(${n(width / 1200)} ${n(height / 630)})"/>
</g>
${particlesLayer(Number(effects.particles) || 0, width, height, theme, title)}
<rect x="34" y="34" width="${width - 68}" height="${height - 68}" rx="18" fill="none" stroke="#fff" stroke-opacity=".055"/>
<g class="fade-up" style="animation-delay:${delays.title}">
<text x="${cx}" y="${layout.title}" text-anchor="middle" class="title">${escapeXml(title)}</text>
${description ? `<text x="${cx}" y="${layout.desc}" text-anchor="middle" class="desc">${escapeXml(description)}</text>` : ''}
<rect x="${cx - 52}" y="${layout.rule}" width="104" height="2" rx="1" fill="url(#accentLine)"/>
</g>
${terminalSvg}
${projects.length ? `<g class="fade-up" style="animation-delay:${delays.projects}">${projectRow}</g>` : ''}
${tagline ? `<g class="fade-up" style="animation-delay:${delays.tagline}"><text x="${cx}" y="${layout.tagline}" text-anchor="middle" class="tagline">${escapeXml(tagline)}</text></g>` : ''}
${skills.length ? `<g class="fade-up" style="animation-delay:${delays.skills}">${skillRow}</g>` : ''}
${contacts.length ? `<g class="fade-up" style="animation-delay:${delays.contacts}">${contactRow}</g>` : ''}
</g>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="#9A9AA4" stroke-opacity=".6"/>
${borderGlow}
</svg>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(path.resolve(args.config), 'utf8'));
  if (args.width) config.width = Number(args.width);
  if (args.height) config.height = Number(args.height);

  const backgroundSvg = await loadBackgroundSvg(args, config);
  if (args['background-out']) {
    const backgroundOut = path.resolve(args['background-out']);
    await mkdir(path.dirname(backgroundOut), { recursive: true });
    await writeFile(backgroundOut, backgroundSvg, 'utf8');
  }

  const output = renderProfile(config, backgroundSvg);
  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, output, 'utf8');
  console.log(`Generated ${outPath} (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
