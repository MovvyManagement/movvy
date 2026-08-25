// =============================================================================
// gen-brand-assets.mjs — regenerate every raster brand asset from one source
//
// The Movvy mark is a bright-green (#0FA353) delivery truck carrying the
// lowercase "movvy" wordmark, sitting on a warm near-black (#282B2A) tile.
// This script is the single source of truth: it builds the mark as an SVG in a
// 150-unit space (mirroring the design mockup exactly) and rasterizes it with
// sharp into the PNGs Expo bakes into the native binaries.
//
//   assets/icon.png           1024²  opaque dark square (iOS masks corners)
//   assets/adaptive-icon.png  1024²  Android foreground (truck only, in the
//                                    72% safe zone; bg color set in app.json)
//   assets/splash-icon.png    1024²  the "movvy" wordmark on transparent, for
//                                    the native splash on white
//   assets/favicon.png          64²  rounded dark tile + truck, for web
//   assets/movvy-icon.svg            the vector source, kept in sync
//
// Run:  node scripts/gen-brand-assets.mjs
// =============================================================================

import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const asset = (p) => join(ROOT, 'assets', p);

// Brand palette (from the design mockup) ------------------------------------
const INK = '#282B2A'; // tile / dark surfaces
const GREEN = '#0FA353'; // primary truck green
const GREEN_DEEP = '#0A7A3E'; // shadow / underside green
const WHITE = '#FFFFFF';
const WORD_INK = '#161615'; // wordmark "mo…y"

// Rounded-rect path with per-corner radii [tl, tr, br, bl]. When a corner
// radius is 0 we emit a straight line so degenerate arcs never appear.
function rr(x, y, w, h, radii) {
  const [tl, tr, br, bl] = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const p = [];
  p.push(`M${x + tl},${y}`);
  p.push(`H${x + w - tr}`);
  if (tr) p.push(`A${tr},${tr} 0 0 1 ${x + w},${y + tr}`);
  p.push(`V${y + h - br}`);
  if (br) p.push(`A${br},${br} 0 0 1 ${x + w - br},${y + h}`);
  p.push(`H${x + bl}`);
  if (bl) p.push(`A${bl},${bl} 0 0 1 ${x},${y + h - bl}`);
  p.push(`V${y + tl}`);
  if (tl) p.push(`A${tl},${tl} 0 0 1 ${x + tl},${y}`);
  p.push('Z');
  return p.join(' ');
}

// The truck, drawn in its own local coordinate space. Content bounding box is
// x:[0..120] y:[6..71] → center (60, 38.5). Everything below is a 1:1 port of
// the design mockup's 150px icon variant.
function truck() {
  return `
    <!-- motion speed lines -->
    <rect x="7" y="28" width="13" height="6" rx="3" fill="${GREEN}"/>
    <rect x="3" y="37" width="16" height="6" rx="3" fill="${GREEN}"/>
    <rect x="0" y="46" width="21" height="6" rx="3" fill="${GREEN}"/>
    <!-- cargo body -->
    <rect x="24" y="6" width="66" height="46" rx="8" fill="${GREEN}"/>
    <path d="${rr(24, 45, 66, 7, [0, 0, 8, 8])}" fill="${GREEN_DEEP}"/>
    <text x="57" y="34" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="900" font-size="16" letter-spacing="-0.6" fill="${WHITE}">movvy</text>
    <!-- cab + window + headlight -->
    <path d="${rr(90, 21, 30, 31, [4, 8, 4, 4])}" fill="${GREEN}"/>
    <path d="${rr(90, 45, 30, 7, [0, 0, 4, 4])}" fill="${GREEN_DEEP}"/>
    <path d="${rr(96, 26, 16, 14, [2, 6, 2, 2])}" fill="${INK}"/>
    <path d="${rr(116, 41, 4, 6, [0, 2, 2, 0])}" fill="${GREEN_DEEP}"/>
    <!-- wheels -->
    <path d="${rr(39, 51, 23, 11, [11, 11, 0, 0])}" fill="${GREEN_DEEP}"/>
    <path d="${rr(92, 51, 23, 11, [11, 11, 0, 0])}" fill="${GREEN_DEEP}"/>
    <circle cx="51" cy="62" r="9" fill="${WHITE}"/>
    <circle cx="104" cy="62" r="9" fill="${WHITE}"/>`;
}

// ---- Composites -------------------------------------------------------------

// App icon: opaque dark square, truck centered (bbox center 60,38.5 → 75,75).
function iconSvg({ rounded = false } = {}) {
  const bg = rounded
    ? `<rect width="150" height="150" rx="34" fill="${INK}"/>`
    : `<rect width="150" height="150" fill="${INK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150">
  ${bg}
  <g transform="translate(15 36.5)">${truck()}</g>
</svg>`;
}

// Android adaptive foreground: transparent, truck scaled into the safe zone.
function adaptiveSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150">
  <g transform="translate(75 75) scale(0.74) translate(-60 -38.5)">${truck()}</g>
</svg>`;
}

// Native-splash wordmark: "mo<vv>y" centered on transparent, for a white bg.
function wordmarkSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <text x="512" y="512" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="900"
        font-size="200" letter-spacing="-10" fill="${WORD_INK}">mo<tspan fill="${GREEN}">vv</tspan>y</text>
</svg>`;
}

// ---- Render -----------------------------------------------------------------

async function png(svg, size, out) {
  await sharp(Buffer.from(svg)).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out);
  console.log('  ✓', out.replace(ROOT + '/', ''));
}

console.log('Generating Movvy brand assets…');
await png(iconSvg(), 1024, asset('icon.png'));
await png(adaptiveSvg(), 1024, asset('adaptive-icon.png'));
await png(wordmarkSvg(), 1024, asset('splash-icon.png'));
await png(iconSvg({ rounded: true }), 64, asset('favicon.png'));
await writeFile(asset('movvy-icon.svg'), iconSvg({ rounded: true }) + '\n', 'utf8');
console.log('  ✓ assets/movvy-icon.svg');
console.log('Done.');
