import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svgPath = process.argv[2];
const outPath = process.argv[3];
const size = parseInt(process.argv[4] ?? '1024', 10);
const bg = process.argv[5];

const svgBuffer = readFileSync(svgPath);
let pipeline = sharp(svgBuffer, { density: 384 }).resize(size, size);
if (bg) pipeline = pipeline.flatten({ background: bg });
await pipeline.png({ compressionLevel: 9 }).toFile(outPath);
console.log(`wrote ${outPath} @ ${size}px`);
