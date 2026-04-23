#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const sourceExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const variants = [
  { width: 400, quality: 78, suffix: 'w400' },
  { width: 1600, quality: 82, suffix: 'w1600' },
  { width: 2400, quality: 95, suffix: 'w2400' },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (path.basename(entry.name, ext) === 'image' && sourceExtensions.has(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

function outputPathFor(sourcePath, suffix) {
  return path.join(path.dirname(sourcePath), `image.${suffix}.webp`);
}

function isCurrent(sourceStat, targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  return fs.statSync(targetPath).mtimeMs >= sourceStat.mtimeMs;
}

async function optimizeVariant(sourcePath, sourceStat, variant) {
  const targetPath = outputPathFor(sourcePath, variant.suffix);
  if (isCurrent(sourceStat, targetPath)) {
    return {
      targetPath,
      status: 'skipped',
      size: fs.statSync(targetPath).size,
    };
  }

  await sharp(sourcePath)
    .resize(variant.width, null, { withoutEnlargement: true })
    .webp({ quality: variant.quality, effort: 5 })
    .toFile(targetPath);

  return {
    targetPath,
    status: 'compressed',
    size: fs.statSync(targetPath).size,
  };
}

export async function optimizeImages({ root = process.cwd(), log = console.log } = {}) {
  const worksDir = path.join(root, 'works');
  const print = typeof log === 'function' ? log : console.log;

  if (!fs.existsSync(worksDir)) {
    throw new Error(`works directory not found: ${path.relative(root, worksDir)}`);
  }

  const sources = walk(worksDir).sort();
  let sourceTotal = 0;
  let outputTotal = 0;
  let compressedCount = 0;
  let skippedCount = 0;

  for (const [index, sourcePath] of sources.entries()) {
    const sourceStat = fs.statSync(sourcePath);
    const sourceSize = sourceStat.size;
    sourceTotal += sourceSize;

    const results = [];
    for (const variant of variants) {
      const result = await optimizeVariant(sourcePath, sourceStat, variant);
      results.push(result);
      outputTotal += result.size;
      if (result.status === 'compressed') compressedCount += 1;
      if (result.status === 'skipped') skippedCount += 1;
    }

    const relSource = path.relative(root, sourcePath);
    const rendered = results
      .map((result) => {
        const name = path.basename(result.targetPath);
        const verb = result.status === 'skipped' ? 'skipped' : 'compressing';
        return `${verb} ${name} (${formatBytes(sourceSize)} -> ${formatBytes(result.size)})`;
      })
      .join(', ');
    print(`[${index + 1}/${sources.length}] ${relSource}: ${rendered}`);
  }

  const webpCount = compressedCount + skippedCount;
  const saved = Math.max(0, sourceTotal - outputTotal);
  print(
    `Total: ${sources.length} sources · ${webpCount} webp · ${compressedCount} compressed · ${skippedCount} skipped · saved ${formatBytes(saved)} (${formatBytes(sourceTotal)} -> ${formatBytes(outputTotal)})`,
  );

  return {
    sourceCount: sources.length,
    webpCount,
    compressedCount,
    skippedCount,
    sourceTotal,
    outputTotal,
    saved,
  };
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCliEntry) {
  optimizeImages().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
