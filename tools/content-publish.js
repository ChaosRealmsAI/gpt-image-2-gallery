#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const INDEX_PATH = path.join(ROOT, 'works', 'index.json');

function run(command, args, { capture = false } = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function hasStagedChanges() {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return false;
  } catch (error) {
    if (typeof error?.status === 'number') return error.status === 1;
    throw error;
  }
}

function stagedFiles() {
  const output = run('git', ['diff', '--cached', '--name-only'], { capture: true }).trim();
  return output ? output.split('\n').filter(Boolean) : [];
}

function countMatching(files, pattern) {
  return files.filter((file) => pattern.test(file)).length;
}

function readIndexImageCountFromFile(file) {
  if (!fs.existsSync(file)) return 0;
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(index.images) ? index.images.length : 0;
}

function readIndexImageCountFromRef(ref) {
  try {
    const text = run('git', ['show', `${ref}:works/index.json`], { capture: true });
    const index = JSON.parse(text);
    return Array.isArray(index.images) ? index.images.length : 0;
  } catch {
    return 0;
  }
}

function buildCommitMessage(files) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const pngCount = countMatching(files, /(^|\/)image\.png$/);
  const webpCount = countMatching(files, /(^|\/)image\.w(?:400|1600)\.webp$/);
  const indexBefore = readIndexImageCountFromRef('HEAD');
  const indexAfter = readIndexImageCountFromFile(INDEX_PATH);
  const sessionId = process.env.CLAUDE_SESSION_ID || 'manual';

  return [
    `chore(content): sync ${timestamp} · +${pngCount} png · +${webpCount} webp · index ${indexBefore}→${indexAfter}`,
    '',
    'Why: automated publish via content:publish script · includes rebuilt index.json · fresh webp for any new png · regenerated README.md + README.zh-CN.md',
    '',
    `session: ${sessionId}`,
  ].join('\n');
}

function main() {
  run('npm', ['run', 'works:index']);
  run('npm', ['run', 'images:optimize']);
  run('npm', ['run', 'readme:gen']);
  run('git', ['add', '-A']);

  if (!hasStagedChanges()) {
    console.log('content:publish: no staged changes after rebuild; skipping commit/push');
    return;
  }

  const files = stagedFiles();
  const message = buildCommitMessage(files);
  run('git', ['commit', '-m', message]);
  run('git', ['push', 'origin', 'main']);
}

main();
