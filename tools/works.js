#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const TODO_PATH = path.join(ROOT, 'todo/atlas-todo.json');
const WORKS_ROOT = path.join(ROOT, 'works');
const LOCALES_PATH = path.join(WORKS_ROOT, 'locales.json');
const TAGS_PATH = path.join(WORKS_ROOT, 'tags.json');
const CATEGORIES_PATH = path.join(WORKS_ROOT, 'categories.json');
const INDEX_PATH = path.join(WORKS_ROOT, 'index.json');

const FALLBACK_REQUIRED_LOCALES = ['en', 'zh-CN'];
const FORBIDDEN_PUBLIC_FIELDS = new Set([
  'task_id',
  'url',
  'local_path',
  'difficulty',
  'research_value',
  'spectacle_score',
  'evaluation',
  'source_todo_ref',
  'created_at',
  'done_at',
  'expires_at',
  'actual_time_sec',
  'size_bytes',
]);
const REQUIRED_PROMPT_SECTIONS = ['Scene:', 'Subject:', 'Important details:', 'Use case:', 'Constraints:'];
const VALID_IMAGE_STATUS = new Set(['prompted', 'running', 'done', 'failed', 'skipped']);

function usage() {
  console.log(`works · public gallery and private production maintenance

Usage:
  node tools/works.js validate [item-id]
  node tools/works.js build-index
  node tools/works.js check-public
  node tools/works.js generate <works/.../meta.json>
  node tools/works.js queue [--concurrency 10] [--limit n] [--retry failed|running] [--with-deps] [--topic id] [--package id] [--dry-run] [--no-loop] [--max-rounds 20] [--max-attempts 2]
  node tools/works.js scan [--topic id] [--package id] [--problems] [--strict] [--json]
  node tools/works.js list [--todo-only] [--with-works]
  node tools/works.js show <item-id>
  node tools/works.js sync <item-id>
  node tools/works.js scaffold-package <item-id> <single|series> <package-slug> [--title "..."] [--image <slug>] [--count <n>]

Examples:
  node tools/works.js validate
  node tools/works.js build-index
  node tools/works.js check-public
  node tools/works.js generate works/topics/high-speed-freeze/packages/single-impact-studies/images/water-crown/meta.json
  node tools/works.js scan --strict
  node tools/works.js queue --concurrency 10
  node tools/works.js scaffold-package high-speed-freeze single impact-study --title "Impact Study" --image water-crown
`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function fileExists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function readJsonIfExists(file, fallback) {
  return fileExists(file) ? readJson(file) : fallback;
}

function requiredLocales() {
  const locales = readJsonIfExists(LOCALES_PATH, null);
  return locales?.required_locales || FALLBACK_REQUIRED_LOCALES;
}

function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function todo() {
  if (!fileExists(TODO_PATH)) {
    throw new Error(`Private todo not found: ${rel(TODO_PATH)}. Public mode supports validate/build-index/check-public only.`);
  }
  return readJson(TODO_PATH);
}

function optionalTodo() {
  return fileExists(TODO_PATH) ? readJson(TODO_PATH) : null;
}

function findItem(data, id) {
  for (const item of data.topics || []) {
    if (item.id === id || item.slug === id || item.legacy_id === id) return { item };
  }
  return null;
}

function allItems(data) {
  return (data.topics || []).map((item) => ({ item }));
}

function topicSlugFor(item) {
  return item.production?.works?.topic_slug
    || item.works?.topic_slug
    || item.slug
    || item.id
    || slugify(item.name || item.title);
}

function topicPathFor(item) {
  return path.join(WORKS_ROOT, 'topics', topicSlugFor(item), 'topic.json');
}

function rel(file) {
  return path.relative(ROOT, file);
}

function walkFiles(dir, predicate, out = []) {
  if (!fileExists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(file, predicate, out);
    else if (!predicate || predicate(file)) out.push(file);
  }
  return out;
}

function topicFiles() {
  return walkFiles(path.join(WORKS_ROOT, 'topics'), (file) => path.basename(file) === 'topic.json').sort();
}

function metaFiles() {
  return walkFiles(path.join(WORKS_ROOT, 'topics'), (file) => path.basename(file) === 'meta.json').sort();
}

function assertNoForbiddenFields(value, file, errors, trail = []) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, file, errors, [...trail, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_FIELDS.has(key)) {
      errors.push(`${file}: forbidden public field ${[...trail, key].join('.')}`);
    }
    assertNoForbiddenFields(child, file, errors, [...trail, key]);
  }
}

function validateLocalizedObject(file, value, errors) {
  const locales = requiredLocales();
  if (!value.i18n || typeof value.i18n !== 'object' || Array.isArray(value.i18n)) {
    errors.push(`${file}: missing i18n`);
    return;
  }
  for (const locale of locales) {
    const entry = value.i18n[locale];
    if (!entry) {
      errors.push(`${file}: missing i18n.${locale}`);
      continue;
    }
    if (typeof entry.title !== 'string' || !entry.title.trim()) {
      errors.push(`${file}: missing i18n.${locale}.title`);
    }
    if (typeof entry.description !== 'string' || !entry.description.trim()) {
      errors.push(`${file}: missing i18n.${locale}.description`);
    }
  }
}

function validateDisplayObject(file, value, errors, requireAlt = false) {
  if (!value.display || typeof value.display !== 'object' || Array.isArray(value.display)) {
    errors.push(`${file}: missing display`);
    return;
  }
  if (!Array.isArray(value.display.audiences)) {
    errors.push(`${file}: display.audiences must be an array`);
  }
  if (!Number.isFinite(value.display.sort_order)) {
    errors.push(`${file}: display.sort_order must be a number`);
  }
  if (requireAlt) {
    const locales = requiredLocales();
    for (const locale of locales) {
      if (typeof value.display.alt?.[locale] !== 'string' || !value.display.alt[locale].trim()) {
        errors.push(`${file}: missing display.alt.${locale}`);
      }
    }
  }
}

function validatePromptSections(file, prompt, errors) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    errors.push(`${file}: prompt must be a non-empty string`);
    return;
  }
  for (const section of REQUIRED_PROMPT_SECTIONS) {
    if (!prompt.includes(section)) errors.push(`${file}: prompt missing ${section}`);
  }
}

function validateGenerationObject(file, meta, errors) {
  if (!VALID_IMAGE_STATUS.has(meta.status)) {
    errors.push(`${file}: status must be one of ${[...VALID_IMAGE_STATUS].join(', ')}`);
  }
  if (!meta.generation || typeof meta.generation !== 'object' || Array.isArray(meta.generation)) {
    errors.push(`${file}: missing generation`);
    return;
  }
  const generation = meta.generation;
  if (!Number.isFinite(generation.order)) errors.push(`${file}: generation.order must be a number`);
  if (generation.mode !== 'image') errors.push(`${file}: generation.mode must be image`);
  if (typeof generation.model !== 'string' || !generation.model.trim()) errors.push(`${file}: missing generation.model`);
  if (typeof generation.output?.path !== 'string' || !generation.output.path.trim()) {
    errors.push(`${file}: missing generation.output.path`);
  }
  if (typeof generation.output?.name !== 'string' || !generation.output.name.trim()) {
    errors.push(`${file}: missing generation.output.name`);
  }
  if (!Array.isArray(generation.depends_on)) errors.push(`${file}: generation.depends_on must be an array`);
  if (!Array.isArray(generation.ref_urls)) {
    errors.push(`${file}: generation.ref_urls must be an array`);
  } else {
    generation.ref_urls.forEach((url, index) => {
      if (typeof url !== 'string' || !url.trim()) {
        errors.push(`${file}: generation.ref_urls[${index}] must be a non-empty string`);
      }
    });
  }

  const metaDir = path.dirname(path.join(ROOT, file));
  const expectedOutput = rel(path.join(metaDir, meta.image || 'image.png'));
  if (generation.output?.path && generation.output.path !== expectedOutput) {
    errors.push(`${file}: generation.output.path must match image path ${expectedOutput}`);
  }
  for (const dep of generation.depends_on || []) {
    for (const field of ['id', 'meta_path', 'image_path', 'ref_role', 'required_status']) {
      if (typeof dep[field] !== 'string' || !dep[field].trim()) {
        errors.push(`${file}: dependency missing ${field}`);
      }
    }
    if (dep.required_status !== 'done') errors.push(`${file}: dependency ${dep.id || '?'} required_status must be done`);
    if (dep.meta_path && path.isAbsolute(dep.meta_path)) {
      errors.push(`${file}: dependency meta_path must be repo-relative`);
    }
    if (dep.image_path && path.isAbsolute(dep.image_path)) {
      errors.push(`${file}: dependency image_path must be repo-relative`);
    }
    const depMetaPath = dep.meta_path ? path.join(ROOT, dep.meta_path) : null;
    if (depMetaPath && !fileExists(depMetaPath)) {
      errors.push(`${file}: dependency meta missing ${dep.meta_path}`);
    }
    if (depMetaPath && fileExists(depMetaPath)) {
      const depMeta = readJson(depMetaPath);
      const expectedDepImage = rel(path.join(path.dirname(depMetaPath), depMeta.image || 'image.png'));
      if (dep.image_path && dep.image_path !== expectedDepImage) {
        errors.push(`${file}: dependency ${dep.id || '?'} image_path must match ${expectedDepImage}`);
      }
    }
  }
}

function validateTagManifest(errors) {
  const tags = readJsonIfExists(TAGS_PATH, null);
  if (!tags) return;
  const locales = requiredLocales();
  for (const [tag, value] of Object.entries(tags.tags || {})) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) errors.push(`${rel(TAGS_PATH)}: invalid tag slug ${tag}`);
    for (const locale of locales) {
      if (typeof value.labels?.[locale] !== 'string' || !value.labels[locale].trim()) {
        errors.push(`${rel(TAGS_PATH)}: missing tags.${tag}.labels.${locale}`);
      }
    }
  }
}

function scanTopic(item) {
  const topicPath = topicPathFor(item);
  if (!fileExists(topicPath)) return null;
  const topic = readJson(topicPath);
  const topicDir = path.dirname(topicPath);
  const packageEntries = [];
  for (const pkgRef of topic.packages || []) {
    const pkgPath = path.join(topicDir, pkgRef.path || `packages/${pkgRef.id}/package.json`);
    if (!fileExists(pkgPath)) {
      packageEntries.push({ missing: true, package_path: rel(pkgPath), package_slug: pkgRef.id || pkgRef.package_slug });
      continue;
    }
    const pkg = readJson(pkgPath);
    const images = Array.isArray(pkg.images) ? pkg.images : [];
    packageEntries.push({
      package_slug: pkg.id || pkg.package_slug,
      package_type: pkg.type || pkg.package_type,
      package_path: rel(pkgPath),
      image_count: images.length,
      creative_direction: pkg.creative_direction || null,
      missing: false,
    });
  }
  const series = packageEntries.filter((p) => p.package_type === 'series').length;
  const singles = packageEntries.filter((p) => p.package_type === 'single').length;
  const imageCount = packageEntries.reduce((sum, p) => sum + (p.image_count || 0), 0);
  return {
    topic_slug: path.basename(topicDir),
    topic_path: rel(topicPath),
    package_count: packageEntries.filter((p) => !p.missing).length,
    series_package_count: series,
    single_package_count: singles,
    image_count: imageCount,
    packages: packageEntries,
  };
}

function listItems(args) {
  const data = todo();
  const todoOnly = args.includes('--todo-only');
  const withWorks = args.includes('--with-works');
  for (const { item } of allItems(data)) {
    if (todoOnly && item.status !== 'todo') continue;
    const works = item.works;
    const suffix = withWorks
      ? ` works=${works ? `${works.package_count || 0}pkg/${works.image_count || 0}img` : 'none'}`
      : '';
    console.log(`${item.id}\t${item.status || 'todo'}\td${item.difficulty ?? '-'}\t${item.name}${suffix}`);
  }
}

function showItem(id) {
  const data = todo();
  const found = findItem(data, id);
  if (!found) throw new Error(`Item not found: ${id}`);
  console.log(JSON.stringify(found.item, null, 2));
}

function syncItem(id) {
  const data = todo();
  const found = findItem(data, id);
  if (!found) throw new Error(`Item not found: ${id}`);
  const works = scanTopic(found.item);
  if (!works) throw new Error(`No topic found for ${id}. Expected ${rel(topicPathFor(found.item))}`);
  const existingNote = found.item.production?.works?.note || found.item.works?.note;
  const nextWorks = {
    ...works,
    note: existingNote || 'Synced from works/.',
  };
  if (found.item.production) found.item.production.works = nextWorks;
  else found.item.works = nextWorks;
  writeJson(TODO_PATH, data);
  console.log(`synced ${id}: ${works.package_count} packages, ${works.image_count} images`);
}

function validateItem(item, errors) {
  const itemWorks = item.production?.works || item.works;
  if (!itemWorks) return;
  const works = scanTopic(item);
  if (!works) {
    errors.push(`${item.id}: works present but topic missing`);
    return;
  }
  const expected = itemWorks;
  for (const key of ['package_count', 'series_package_count', 'single_package_count', 'image_count']) {
    if ((expected[key] || 0) !== (works[key] || 0)) {
      errors.push(`${item.id}: works.${key}=${expected[key]} but scanned=${works[key]}`);
    }
  }
  for (const pkg of works.packages) {
    if (pkg.missing) {
      errors.push(`${item.id}: missing package ${pkg.package_path}`);
      continue;
    }
    if (!pkg.creative_direction) errors.push(`${item.id}/${pkg.package_slug}: missing creative_direction`);
    const pkgJson = readJson(path.join(ROOT, pkg.package_path));
    const pkgRel = pkg.package_path;
    assertNoForbiddenFields(pkgJson, pkgRel, errors);
    validateLocalizedObject(pkgRel, pkgJson, errors);
    validateDisplayObject(pkgRel, pkgJson, errors);
    const pkgDir = path.dirname(path.join(ROOT, pkg.package_path));
    for (const image of pkgJson.images || []) {
      const metaRel = image.meta || image.path;
      if (!metaRel) {
        errors.push(`${item.id}/${pkg.package_slug}/${image.id}: missing meta path`);
        continue;
      }
      const metaPath = path.join(pkgDir, metaRel);
      let imagePath = image.image ? path.join(pkgDir, image.image) : path.join(path.dirname(metaPath), 'image.png');
      if (!fileExists(metaPath)) errors.push(`${item.id}/${pkg.package_slug}/${image.id}: missing meta.json`);
      if (fileExists(metaPath)) {
        const meta = readJson(metaPath);
        if (!image.image && meta.image) imagePath = path.join(path.dirname(metaPath), meta.image);
        for (const field of ['prompt', 'id', 'title', 'description', 'type', 'image', 'aspect_ratio', 'tags', 'refs', 'status', 'generation']) {
          if (!(field in meta)) errors.push(`${rel(metaPath)}: missing ${field}`);
        }
        const firstKey = Object.keys(meta)[0];
        if (firstKey !== 'prompt') errors.push(`${rel(metaPath)}: prompt must be first key`);
        assertNoForbiddenFields(meta, rel(metaPath), errors);
        validateLocalizedObject(rel(metaPath), meta, errors);
        validateDisplayObject(rel(metaPath), meta, errors, true);
        validatePromptSections(rel(metaPath), meta.prompt, errors);
        validateGenerationObject(rel(metaPath), meta, errors);
      }
      if (!fileExists(imagePath)) {
        const meta = fileExists(metaPath) ? readJson(metaPath) : {};
        if (!['prompted', 'running', 'failed', 'skipped'].includes(meta.status)) errors.push(`${item.id}/${pkg.package_slug}/${image.id}: missing image.png`);
      }
    }
  }
}

function validateWorksTree(errors) {
  validateTagManifest(errors);
  for (const topicPath of topicFiles()) {
    const topic = readJson(topicPath);
    const topicRel = rel(topicPath);
    assertNoForbiddenFields(topic, topicRel, errors);
    for (const field of ['id', 'title', 'description', 'packages']) {
      if (!(field in topic)) errors.push(`${topicRel}: missing ${field}`);
    }
    validateLocalizedObject(topicRel, topic, errors);
    validateDisplayObject(topicRel, topic, errors);
    const topicDir = path.dirname(topicPath);
    for (const pkgRef of topic.packages || []) {
      const pkgPath = path.join(topicDir, pkgRef.path || `packages/${pkgRef.id}/package.json`);
      if (!fileExists(pkgPath)) {
        errors.push(`${topicRel}: missing package ${pkgRef.path || pkgRef.id}`);
      }
    }
  }
}

function validate(id) {
  const errors = [];
  const data = optionalTodo();
  if (id && !data) {
    throw new Error(`Private todo is required to validate one item: ${id}`);
  }
  if (id) {
    const found = findItem(data, id);
    if (!found) throw new Error(`Item not found: ${id}`);
    validateItem(found.item, errors);
  } else {
    if (data) {
      for (const { item } of allItems(data)) validateItem(item, errors);
    }
    validateWorksTree(errors);
  }
  if (errors.length) {
    for (const error of errors) console.error(`x ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(id ? `ok ${id}` : 'ok');
}

function topicTodoItemByTopicPath(data, topicPath) {
  if (!data) return null;
  const topicRel = rel(topicPath);
  return allItems(data).find(({ item }) => (item.production?.works || item.works)?.topic_path === topicRel)?.item || null;
}

function imageEntryForIndex(topic, topicPath, pkg, pkgPath, imageRef, meta, metaPath) {
  const pkgDir = path.dirname(pkgPath);
  const imagePath = path.join(path.dirname(metaPath), meta.image || 'image.png');
  const imageRel = rel(imagePath);
  return {
    id: `${topic.id}/${pkg.id}/${meta.id}`,
    image_id: meta.id,
    package_id: pkg.id,
    topic_id: topic.id,
    topic_slug: topic.slug || topic.id,
    title: meta.title,
    description: meta.description,
    i18n: meta.i18n || {},
    display: meta.display || {},
    status: meta.status || 'done',
    generation: meta.generation || null,
    type: meta.type || pkg.type,
    aspect_ratio: meta.aspect_ratio,
    tags: meta.tags || [],
    refs: meta.refs || [],
    image: imageRel,
    meta_path: rel(metaPath),
    package_path: rel(pkgPath),
    topic_path: rel(topicPath),
    package_title: pkg.title,
    topic_title: topic.title,
    package_ref_image: imageRef.image ? rel(path.join(pkgDir, imageRef.image)) : imageRel,
  };
}

function buildIndex() {
  const data = optionalTodo();
  const existingIndex = readJsonIfExists(INDEX_PATH, {});
  const locales = readJsonIfExists(LOCALES_PATH, {
    default_locale: 'en',
    required_locales: FALLBACK_REQUIRED_LOCALES,
    supported_locales: FALLBACK_REQUIRED_LOCALES.map((code) => ({ code })),
  });
  const tags = readJsonIfExists(TAGS_PATH, { tags: {} });
  const categories = readJsonIfExists(CATEGORIES_PATH, {
    category: {},
    style: {},
    capability: {},
  });
  const topics = [];
  const packages = [];
  const images = [];

  for (const topicPath of topicFiles()) {
    const topic = readJson(topicPath);
    const topicDir = path.dirname(topicPath);
    const item = topicTodoItemByTopicPath(data, topicPath);
    const topicPackages = [];

    for (const pkgRef of topic.packages || []) {
      const pkgPath = path.join(topicDir, pkgRef.path || `packages/${pkgRef.id}/package.json`);
      if (!fileExists(pkgPath)) continue;
      const pkg = readJson(pkgPath);
      const pkgDir = path.dirname(pkgPath);
      const packageImages = [];
      for (const imageRef of pkg.images || []) {
        const metaRel = imageRef.meta || imageRef.path;
        if (!metaRel) continue;
        const metaPath = path.join(pkgDir, metaRel);
        if (!fileExists(metaPath)) continue;
        const meta = readJson(metaPath);
        const imagePath = path.join(path.dirname(metaPath), meta.image || 'image.png');
        // after PNG slim, png may be removed but w{400,1600,2400}.webp remain; accept either
        const webpThumb = imagePath.replace(/\.(png|jpg|jpeg|webp)$/i, '.w400.webp');
        const hasImage = fileExists(imagePath) || fileExists(webpThumb);
        if (meta.status !== 'done' || !hasImage) continue;
        const indexed = imageEntryForIndex(topic, topicPath, pkg, pkgPath, imageRef, meta, metaPath);
        images.push(indexed);
        packageImages.push(indexed.id);
      }
      if (!packageImages.length) continue;
      const indexedPkg = {
        id: pkg.id,
        topic_id: topic.id,
        topic_slug: topic.slug || topic.id,
        type: pkg.type,
        title: pkg.title,
        description: pkg.description,
        creative_direction: pkg.creative_direction,
        i18n: pkg.i18n || {},
        display: pkg.display || {},
        cover_image: pkg.cover_image ? rel(path.join(pkgDir, pkg.cover_image)) : null,
        image_count: packageImages.length,
        images: packageImages,
        package_path: rel(pkgPath),
        topic_path: rel(topicPath),
      };
      packages.push(indexedPkg);
      topicPackages.push(indexedPkg.id);
    }
    if (!topicPackages.length) continue;

    topics.push({
      id: topic.id,
      slug: topic.slug || topic.id,
      category: topic.category || null,
      style: Array.isArray(topic.style) ? topic.style : [],
      capability: Array.isArray(topic.capability) ? topic.capability : [],
      todo_id: item?.id || item?.legacy_id || topic.id,
      title: topic.title,
      short_title: topic.short_title,
      description: topic.description,
      i18n: topic.i18n || {},
      display: topic.display || {},
      package_count: topicPackages.length,
      image_count: packages
        .filter((pkg) => pkg.topic_id === topic.id)
        .reduce((sum, pkg) => sum + pkg.image_count, 0),
      packages: topicPackages,
      topic_path: rel(topicPath),
    });
  }

  const index = {
    generated_at: existingIndex.generated_at || new Date().toISOString(),
    schema_version: 1,
    default_locale: locales.default_locale || 'en',
    required_locales: locales.required_locales || FALLBACK_REQUIRED_LOCALES,
    supported_locales: locales.supported_locales || [],
    tag_labels: tags.tags || {},
    categories,
    stats: {
      topic_count: topics.length,
      package_count: packages.length,
      image_count: images.length,
    },
    topics,
    packages,
    images,
  };
  writeJson(INDEX_PATH, index);
  console.log(`built ${rel(INDEX_PATH)}: ${topics.length} topics, ${packages.length} packages, ${images.length} images`);
}

function getArg(args, name, fallback = undefined) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

function intArg(args, name, fallback) {
  const raw = getArg(args, name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeIntArg(args, name, fallback) {
  const raw = getArg(args, name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function queueLimitArg(args) {
  return args.includes('--limit') ? nonNegativeIntArg(args, '--limit', 1) : null;
}

function generateImage(args) {
  const metaArg = args[0];
  if (!metaArg) throw new Error('Usage: generate <works/.../meta.json>');
  const metaPath = path.resolve(ROOT, metaArg);
  if (!metaPath.startsWith(WORKS_ROOT + path.sep)) {
    throw new Error(`Meta path must be inside works/: ${metaArg}`);
  }
  if (!fileExists(metaPath)) throw new Error(`Missing meta.json: ${metaArg}`);
  const meta = readJson(metaPath);
  const errors = [];
  validatePromptSections(rel(metaPath), meta.prompt, errors);
  validateGenerationObject(rel(metaPath), meta, errors);
  if (errors.length) throw new Error(errors.join('\n'));
  const generation = meta.generation || {};
  const dependsOn = generation.depends_on || [];
  const refUrls = generation.ref_urls || [];
  if (dependsOn.length && refUrls.length !== dependsOn.length) {
    const deps = dependsOn.map((dep) => `${dep.id} (${dep.meta_path})`).join(', ');
    throw new Error([
      `${rel(metaPath)} depends on ${dependsOn.length} image(s), but generation.ref_urls has ${refUrls.length}.`,
      `Dependencies: ${deps}`,
      'Inject dependency result URLs into generation.ref_urls at runtime, then rerun works:generate.',
    ].join('\n'));
  }
  const outputPath = path.join(ROOT, generation.output.path);
  const outDir = path.dirname(outputPath);
  const command = [
    meta.prompt,
    ...refUrls.flatMap((url) => ['--ref', url]),
    '--size',
    meta.aspect_ratio || '1:1',
    '--out',
    outDir,
    '--name',
    generation.output.name || path.basename(meta.image || 'image.png', '.png'),
  ];
  try {
    const output = execFileSync('image2gen', command, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(output);
    if (!fileExists(outputPath)) {
      throw new Error(`image2gen completed but did not write ${rel(outputPath)}`);
    }
    meta.status = 'done';
    meta.generation.ref_urls = [];
    delete meta.generation.last_error;
    writeJson(metaPath, meta);
  } catch (error) {
    const failed = readJson(metaPath);
    const output = [
      error?.stdout?.toString?.() || '',
      error?.stderr?.toString?.() || '',
      error?.message || String(error),
    ].filter(Boolean).join('\n');
    if (error?.stdout) process.stdout.write(error.stdout.toString());
    if (error?.stderr) process.stderr.write(error.stderr.toString());
    failed.status = 'failed';
    failed.generation ||= {};
    failed.generation.ref_urls = [];
    failed.generation.last_error = failureSummary(output, error?.status ?? 1, outputPath);
    writeJson(metaPath, failed);
    throw error;
  }
}

function parseImageUrl(text) {
  const matches = [...String(text).matchAll(/https:\/\/[^\s)]+\.png/g)];
  return matches.length ? matches[matches.length - 1][0] : null;
}

function failureSummary(output, code, outputPath) {
  const text = String(output);
  const timeout = text.match(/poll 超时 \d+s|timeout|timed out/i)?.[0] || null;
  const errorLine = text.split('\n').reverse().find((line) => /❌|error|failed|timeout|超时/i.test(line)) || null;
  return {
    reason: timeout || errorLine || (code === 0 ? 'missing output image' : `image2gen exited ${code}`),
    retryable: true,
    output_path: rel(outputPath),
    checked_at: new Date().toISOString(),
  };
}

function loadMetaTasks(args) {
  const topicFilter = getArg(args, '--topic', '');
  const packageFilter = getArg(args, '--package', '');
  const tasks = [];
  for (const metaPath of metaFiles()) {
    const meta = readJson(metaPath);
    const metaRel = rel(metaPath);
    const pkgRel = `${metaRel.split('/images/')[0]}/package.json`;
    const topicRel = `${metaRel.split('/packages/')[0]}/topic.json`;
    const pkgPath = path.join(ROOT, pkgRel);
    const topicPath = path.join(ROOT, topicRel);
    const pkg = fileExists(pkgPath) ? readJson(pkgPath) : {};
    const topic = fileExists(topicPath) ? readJson(topicPath) : {};
    if (topicFilter && topic.id !== topicFilter) continue;
    if (packageFilter && pkg.id !== packageFilter) continue;
    tasks.push({
      metaPath,
      metaRel,
      meta,
      pkg,
      topic,
      outputPath: path.join(ROOT, meta.generation?.output?.path || path.join(path.dirname(metaRel), meta.image || 'image.png')),
    });
  }
  return tasks.sort((a, b) => {
    return (a.topic.id || '').localeCompare(b.topic.id || '')
      || (a.pkg.id || '').localeCompare(b.pkg.id || '')
      || (a.meta.generation?.order || 0) - (b.meta.generation?.order || 0)
      || a.meta.id.localeCompare(b.meta.id);
  });
}

function loadQueueTasks(args) {
  const retry = getArg(args, '--retry', '');
  const withDeps = args.includes('--with-deps');
  const maxAttempts = intArg(args, '--max-attempts', 2);
  const allowedStatuses = new Set(['prompted']);
  if (retry === 'failed') allowedStatuses.add('failed');
  if (retry === 'running') allowedStatuses.add('running');
  const allTasks = loadMetaTasks(args);
  const byMetaPath = new Map(allTasks.map((task) => [task.metaRel, task]));
  // filter: allowed status AND (for failed) attempt_count < maxAttempts
  // prevents endless retry of unfixable prompts (e.g. IP/safety-blocked)
  const selected = new Map(allTasks.filter((task) => {
    if (!allowedStatuses.has(task.meta.status)) return false;
    const attempts = task.meta.generation?.attempt_count ?? 0;
    if (task.meta.status === 'failed' && attempts >= maxAttempts) return false;
    return true;
  }).map((task) => [task.metaRel, task]));

  if (withDeps) {
    const visitDeps = (task) => {
      for (const dep of task.meta.generation?.depends_on || []) {
        const depTask = byMetaPath.get(dep.meta_path);
        if (!depTask || selected.has(depTask.metaRel)) continue;
        selected.set(depTask.metaRel, depTask);
        visitDeps(depTask);
      }
    };
    for (const task of [...selected.values()]) visitDeps(task);
  }

  return [...selected.values()].sort((a, b) => {
    return (a.topic.id || '').localeCompare(b.topic.id || '')
      || (a.pkg.id || '').localeCompare(b.pkg.id || '')
      || (a.meta.generation?.order || 0) - (b.meta.generation?.order || 0)
      || a.meta.id.localeCompare(b.meta.id);
  });
}

function dependencyScanState(task) {
  const blockers = [];
  const refs = [];
  for (const dep of task.meta.generation?.depends_on || []) {
    const depName = dep.id || dep.meta_path || '?';
    if (!dep.meta_path) {
      blockers.push(`${depName} missing meta_path`);
      continue;
    }
    const depMetaPath = path.join(ROOT, dep.meta_path);
    if (!fileExists(depMetaPath)) {
      blockers.push(`${depName} missing meta`);
      continue;
    }
    const depMeta = readJson(depMetaPath);
    const depImagePath = dep.image_path
      ? path.join(ROOT, dep.image_path)
      : path.join(path.dirname(depMetaPath), depMeta.image || 'image.png');
    if (depMeta.status !== 'done') {
      blockers.push(`${depName} status=${depMeta.status || 'unknown'}`);
      continue;
    }
    if (!fileExists(depImagePath)) {
      blockers.push(`${depName} done but missing ${rel(depImagePath)}`);
      continue;
    }
    refs.push(dep.image_path || rel(depImagePath));
  }
  return { blockers, refs };
}

function taskHealth(task) {
  const errors = [];
  validateGenerationObject(task.metaRel, task.meta, errors);
  const imageExists = fileExists(task.outputPath);
  const deps = dependencyScanState(task);
  let state = 'invalid';
  let reason = errors[0] || '';
  const status = task.meta.status || 'unknown';

  if (!errors.length) {
    if (status === 'done') {
      state = imageExists ? 'done' : 'missing_image';
      reason = imageExists ? '' : `status=done but missing ${rel(task.outputPath)}`;
    } else if (status === 'failed') {
      state = 'failed';
      reason = task.meta.generation?.last_error?.reason || 'failed without generation.last_error';
    } else if (status === 'running') {
      state = imageExists ? 'running_with_output' : 'running';
      reason = imageExists
        ? `status=running but output exists at ${rel(task.outputPath)}`
        : 'status=running; retry with --retry running if no queue is active';
    } else if (status === 'skipped') {
      state = 'skipped';
      reason = 'intentionally not queued';
    } else if (status === 'prompted') {
      state = deps.blockers.length ? 'blocked' : 'ready';
      reason = deps.blockers.join('; ');
    }
  }

  return {
    state,
    status,
    image_exists: imageExists,
    dependency_count: task.meta.generation?.depends_on?.length || 0,
    ready_ref_count: deps.refs.length,
    retryable: Boolean(task.meta.generation?.last_error?.retryable),
    meta_path: task.metaRel,
    output_path: rel(task.outputPath),
    reason,
    errors,
  };
}

function scanQueue(args) {
  const json = args.includes('--json');
  const problemsOnly = args.includes('--problems');
  const strict = args.includes('--strict');
  const tasks = loadMetaTasks(args);
  const rows = tasks.map((task) => taskHealth(task));
  const counts = {
    total: rows.length,
    done: 0,
    ready: 0,
    blocked: 0,
    failed: 0,
    running: 0,
    running_with_output: 0,
    missing_image: 0,
    skipped: 0,
    invalid: 0,
  };
  for (const row of rows) {
    if (row.state in counts) counts[row.state] += 1;
  }
  const unfinished = rows.filter((row) => !['done', 'skipped'].includes(row.state));

  if (json) {
    console.log(JSON.stringify({ counts, rows }, null, 2));
  } else {
    console.log([
      `scan: total=${counts.total}`,
      `done=${counts.done}`,
      `ready=${counts.ready}`,
      `blocked=${counts.blocked}`,
      `failed=${counts.failed}`,
      `running=${counts.running + counts.running_with_output}`,
      `missing=${counts.missing_image}`,
      `skipped=${counts.skipped}`,
      `invalid=${counts.invalid}`,
    ].join(' '));
    for (const row of rows) {
      if (problemsOnly && ['done', 'skipped'].includes(row.state)) continue;
      const reason = row.reason ? `\t${row.reason}` : '';
      const retry = row.retryable ? '\tretryable=true' : '';
      console.log(`${row.state}\tstatus=${row.status}\timage=${row.image_exists ? 'yes' : 'no'}\tdeps=${row.ready_ref_count}/${row.dependency_count}\t${row.meta_path}${retry}${reason}`);
    }
  }

  if (strict && unfinished.length) {
    process.exitCode = 1;
  }
}

function dependencyState(task, resultUrls) {
  const missing = [];
  const failed = [];
  const refUrls = [];
  for (const dep of task.meta.generation?.depends_on || []) {
    const depMetaPath = path.join(ROOT, dep.meta_path || '');
    if (!dep.meta_path || !fileExists(depMetaPath)) {
      missing.push(`${dep.id || '?'} missing meta`);
      continue;
    }
    const depMeta = readJson(depMetaPath);
    if (depMeta.status === 'failed') {
      failed.push(dep.id || dep.meta_path);
      continue;
    }
    if (depMeta.status !== 'done') {
      missing.push(`${dep.id || dep.meta_path} status=${depMeta.status || 'unknown'}`);
      continue;
    }
    const url = resultUrls.get(dep.meta_path);
    if (!url) {
      missing.push(`${dep.id || dep.meta_path} has no runtime ref URL`);
      continue;
    }
    refUrls.push(url);
  }
  return { ready: !missing.length && !failed.length, missing, failed, refUrls };
}

function writeQueueLog(runDir, state) {
  writeJson(path.join(runDir, 'run.json'), state);
}

function runImageTask(task, refUrls, runDir, runState) {
  return new Promise((resolve) => {
    const latest = readJson(task.metaPath);
    latest.status = 'running';
    latest.generation.ref_urls = [];
    latest.generation.attempt_count = (latest.generation.attempt_count ?? 0) + 1;
    delete latest.generation.last_error;
    writeJson(task.metaPath, latest);

    const outputPath = path.join(ROOT, latest.generation.output.path);
    const command = [
      latest.prompt,
      ...refUrls.flatMap((url) => ['--ref', url]),
      '--size',
      latest.aspect_ratio || '1:1',
      '--out',
      path.dirname(outputPath),
      '--name',
      latest.generation.output.name || path.basename(latest.image || 'image.png', '.png'),
    ];
    const startedAt = new Date().toISOString();
    console.log(`queue start refs=${refUrls.length} ${task.metaRel}`);
    const child = spawn('image2gen', command, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      output += `\n${error.message}\n`;
    });
    child.on('close', (code) => {
      const current = readJson(task.metaPath);
      const resultUrl = parseImageUrl(output);
      const succeeded = code === 0 && fileExists(outputPath);
      current.status = succeeded ? 'done' : 'failed';
      current.generation.ref_urls = [];
      if (succeeded) delete current.generation.last_error;
      else current.generation.last_error = failureSummary(output, code, outputPath);
      writeJson(task.metaPath, current);

      const logPath = path.join(runDir, `${task.meta.id}.log`);
      fs.writeFileSync(logPath, output);
      const record = {
        meta_path: task.metaRel,
        status: current.status,
        started_at: startedAt,
        done_at: new Date().toISOString(),
        output_path: rel(outputPath),
        result_url: resultUrl,
        exit_code: code,
        log_path: rel(logPath),
      };
      runState.tasks[task.metaRel] = record;
      writeQueueLog(runDir, runState);
      console.log(`queue ${current.status} ${task.metaRel}`);
      resolve({ task, succeeded, resultUrl });
    });
  });
}

async function runQueue(args) {
  // PID lock: ensure single-instance queue globally (no double-dispatch)
  const lockFile = path.join(ROOT, 'tmp', '.queue.pid');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (fileExists(lockFile)) {
    const existingPid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (Number.isFinite(existingPid)) {
      try {
        process.kill(existingPid, 0);
        console.error(`queue: another instance already running (pid=${existingPid}) · exit.\n`
          + `  · to adopt the existing queue, wait for it to finish\n`
          + `  · to force start (dangerous), remove ${rel(lockFile)} manually`);
        process.exitCode = 1;
        return;
      } catch { /* stale lock - remove below */ }
    }
    fs.unlinkSync(lockFile);
  }
  fs.writeFileSync(lockFile, String(process.pid));
  const releaseLock = () => { try { fs.unlinkSync(lockFile); } catch { /* gone */ } };
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(130); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

  // auto-loop: keep polling for new prompted/failed/running tasks until queue drains
  // disable with --no-loop
  const autoLoop = !args.includes('--no-loop');
  const maxRounds = intArg(args, '--max-rounds', 20);
  // when looping, default-retry failed+running so newly-stuck tasks get a second chance
  const effectiveArgs = autoLoop && !args.includes('--retry')
    ? [...args, '--retry', 'failed']
    : args;

  let round = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let lastBlocked = 0;

  try {
    while (round < maxRounds) {
      round++;
      const summary = await runQueueRound(effectiveArgs, round);
      totalSucceeded += summary.succeeded;
      totalFailed += summary.failed;
      lastBlocked = summary.blocked;
      if (!autoLoop) break;
      if (summary.initialTasks === 0) break;
      // re-scan: anything still pending / failed / running means try again
      const remaining = loadMetaTasks(effectiveArgs).filter((t) => ['prompted', 'failed', 'running'].includes(t.meta.status));
      if (remaining.length === 0) {
        console.log(`queue auto-loop: all tasks settled after round ${round}`);
        break;
      }
      console.log(`queue auto-loop: round ${round} done · ${remaining.length} still need attention · starting round ${round + 1}`);
    }

    console.log(`queue overall: rounds=${round} succeeded=${totalSucceeded} failed=${totalFailed} blocked=${lastBlocked}`);

    const limit = queueLimitArg(args);
    const shouldOptimize = !args.includes('--dry-run') && limit !== 0 && lastBlocked === 0;
    if (shouldOptimize) {
      console.log('\nqueue drained · running images:optimize for new png...');
      try {
        const { optimizeImages } = await import('./images-optimize.js');
        await optimizeImages();
        console.log('optimize done · new webp ready');
      } catch (error) {
        console.warn(`queue drained · images:optimize failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    releaseLock();
  }
}

async function runQueueRound(args, round) {
  const concurrency = intArg(args, '--concurrency', 10);
  const limit = queueLimitArg(args);
  const dryRun = args.includes('--dry-run');
  const allowIncomplete = args.includes('--allow-incomplete');
  const tasks = limit === null ? loadQueueTasks(args) : loadQueueTasks(args).slice(0, limit);
  const pending = new Map(tasks.map((task) => [task.metaRel, task]));
  const running = new Set();
  const blocked = new Map();
  const completed = [];
  const resultUrls = new Map();
  const runDir = path.join(ROOT, 'tmp', 'queue-runs', new Date().toISOString().replace(/[:.]/g, '-'));
  const runState = {
    started_at: new Date().toISOString(),
    round,
    concurrency,
    dry_run: dryRun,
    tasks: {},
  };

  if (!tasks.length) {
    console.log(`queue round ${round}: no prompted tasks`);
    return { succeeded: 0, failed: 0, blocked: 0, initialTasks: 0 };
  }
  fs.mkdirSync(runDir, { recursive: true });

  function readyTasks() {
    blocked.clear();
    const ready = [];
    for (const task of pending.values()) {
      const deps = dependencyState(task, resultUrls);
      if (deps.ready) ready.push({ task, refUrls: deps.refUrls });
      else blocked.set(task.metaRel, [...deps.failed, ...deps.missing]);
    }
    return ready;
  }

  if (dryRun) {
    const ready = readyTasks();
    console.log(`queue dry-run: tasks=${tasks.length} ready=${ready.length} blocked=${blocked.size} concurrency=${concurrency}`);
    for (const { task, refUrls } of ready) console.log(`ready\trefs=${refUrls.length}\t${task.metaRel}`);
    for (const [file, reasons] of blocked) console.log(`blocked\t${file}\t${reasons.join('; ')}`);
    return { succeeded: 0, failed: 0, blocked: blocked.size, initialTasks: tasks.length };
  }

  await new Promise((resolve) => {
    const schedule = () => {
      const ready = readyTasks();
      while (running.size < concurrency && ready.length) {
        const { task, refUrls } = ready.shift();
        if (!pending.has(task.metaRel)) continue;
        pending.delete(task.metaRel);
        const promise = runImageTask(task, refUrls, runDir, runState).then((result) => {
          completed.push(result);
          running.delete(promise);
          if (result.succeeded && result.resultUrl) resultUrls.set(result.task.metaRel, result.resultUrl);
          schedule();
        });
        running.add(promise);
      }
      if (!pending.size && !running.size) resolve();
      if (pending.size && !running.size && !ready.length) {
        for (const [file, reasons] of blocked) console.error(`queue blocked ${file}: ${reasons.join('; ')}`);
        resolve();
      }
    };
    schedule();
  });

  runState.done_at = new Date().toISOString();
  runState.summary = {
    succeeded: completed.filter((result) => result.succeeded).length,
    failed: completed.filter((result) => !result.succeeded).length,
    blocked: pending.size,
  };
  if (pending.size) {
    runState.blocked = Object.fromEntries([...blocked.entries()]);
  }
  writeQueueLog(runDir, runState);
  buildIndex();
  console.log([
    `queue round ${round} complete: succeeded=${runState.summary.succeeded}`,
    `failed=${runState.summary.failed}`,
    `blocked=${runState.summary.blocked}`,
    `log ${rel(path.join(runDir, 'run.json'))}`,
  ].join(' '));
  if (!allowIncomplete && (runState.summary.failed || runState.summary.blocked)) {
    process.exitCode = 1;
  }
  return {
    succeeded: runState.summary.succeeded,
    failed: runState.summary.failed,
    blocked: runState.summary.blocked,
    initialTasks: tasks.length,
  };
}

function checkPublic() {
  const errors = [];
  validateWorksTree(errors);
  const privatePathPatterns = [
    /^todo\//,
    /^prototype\//,
    /^research-materials\//,
    /^new\/todo\//,
    /^new\/prototype\//,
    /^new\/research-materials\//,
    /^content\//,
    /^assets\//,
    /^api\//,
    /^docs\//,
    /^frontend\//,
    /^spec\//,
    /^\.claude\//,
  ];
  try {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).split('\n').filter(Boolean);
    for (const file of tracked) {
      if (privatePathPatterns.some((pattern) => pattern.test(file))) {
        errors.push(`private or legacy file is tracked: ${file}`);
      }
    }
  } catch {
    // Not a git checkout. Schema validation above still gives useful public checks.
  }
  if (errors.length) {
    for (const error of errors) console.error(`x ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('ok public boundary');
}

function scaffoldPackage(args) {
  const [id, type, packageSlug] = args;
  if (!id || !type || !packageSlug || !['single', 'series'].includes(type)) {
    throw new Error('Usage: scaffold-package <item-id> <single|series> <package-slug> [--title "..."] [--image <slug>] [--count <n>]');
  }
  const data = todo();
  const found = findItem(data, id);
  if (!found) throw new Error(`Item not found: ${id}`);
  const item = found.item;
  const topicSlug = topicSlugFor(item);
  const topicDir = path.join(WORKS_ROOT, 'topics', topicSlug);
  const topicPath = path.join(topicDir, 'topic.json');
  const title = getArg(args, '--title', packageSlug.split('-').map((s) => s[0]?.toUpperCase() + s.slice(1)).join(' '));
  const count = Number(getArg(args, '--count', type === 'series' ? '3' : '1'));
  const baseImageSlug = getArg(args, '--image', type === 'series' ? '01-image' : 'hero');
  const fullPackageSlug = packageSlug.startsWith(`${type}-`) ? packageSlug : `${type}-${packageSlug}`;
  const pkgDir = path.join(topicDir, 'packages', fullPackageSlug);
  const pkgPath = path.join(pkgDir, 'package.json');
  if (fileExists(pkgPath)) throw new Error(`Package already exists: ${rel(pkgPath)}`);

  let topic = fileExists(topicPath)
    ? readJson(topicPath)
    : {
        id: topicSlug,
        slug: topicSlug,
        title: item.title || item.name,
      description: item.description || item.example || item.dimension || '',
      i18n: {
        en: {
          title: item.i18n?.en?.title || item.title || item.name,
          description: item.i18n?.en?.description || item.description || item.example || item.dimension || '',
        },
        'zh-CN': {
          title: item.i18n?.['zh-CN']?.title || item.name || item.title,
          description: item.i18n?.['zh-CN']?.description || item.example || item.dimension || '',
        },
      },
      display: {
        featured: false,
        sort_order: 100,
        audiences: ['gallery'],
      },
      packages: [],
    };
  topic.packages = topic.packages || [];
  topic.packages.push({
    id: fullPackageSlug,
    type,
    title,
    path: `packages/${fullPackageSlug}/package.json`,
  });
  writeJson(topicPath, topic);

  const imageSlugs = [];
  for (let i = 1; i <= count; i++) {
    if (type === 'single') imageSlugs.push(baseImageSlug);
    else {
      const base = baseImageSlug.replace(/^\d+-/, '');
      imageSlugs.push(`${String(i).padStart(2, '0')}-${base}`);
    }
  }

  const images = imageSlugs.map((slug) => ({
    id: slug,
    title: slug.split('-').map((s) => s[0]?.toUpperCase() + s.slice(1)).join(' '),
    image: `images/${slug}/image.png`,
    meta: `images/${slug}/meta.json`,
  }));
  const pkg = {
    id: fullPackageSlug,
    type,
    title,
    description: '',
    creative_direction: 'TODO: explain how this package differs from existing packages under this topic.',
    cover_image: images[0]?.image || null,
    i18n: {
      en: {
        title,
        description: '',
      },
      'zh-CN': {
        title,
        description: '',
      },
    },
    display: {
      featured: false,
      sort_order: 100,
      audiences: ['gallery'],
    },
    images,
  };
  writeJson(pkgPath, pkg);

  for (const image of images) {
    const imageDir = path.join(pkgDir, 'images', image.id);
    writeJson(path.join(imageDir, 'meta.json'), {
      prompt: 'Scene: TODO\n\nSubject: TODO\n\nImportant details: TODO\n\nUse case: TODO\n\nConstraints: TODO',
      id: image.id,
      title: image.title,
      description: '',
      type,
      image: 'image.png',
      aspect_ratio: '16:9',
      tags: [],
      refs: [],
      i18n: {
        en: {
          title: image.title,
          description: '',
        },
        'zh-CN': {
          title: image.title,
          description: '',
        },
      },
      display: {
        featured: false,
        sort_order: 100,
        audiences: ['gallery'],
        alt: {
          en: image.title,
          'zh-CN': image.title,
        },
      },
    });
  }

  const scanned = scanTopic(item) || {
    topic_slug: topicSlug,
    topic_path: rel(topicPath),
    package_count: 0,
    series_package_count: 0,
    single_package_count: 0,
    image_count: 0,
    packages: [],
  };
  item.works = {
    ...scanned,
    note: item.works?.note || 'Package scaffolded; fill creative_direction, prompts, then generate images.',
  };
  writeJson(TODO_PATH, data);
  console.log(`created ${rel(pkgPath)}`);
}

const [command, ...args] = process.argv.slice(2);

async function main() {
  if (!command || ['-h', '--help', 'help'].includes(command)) usage();
  else if (command === 'list') listItems(args);
  else if (command === 'show') showItem(args[0]);
  else if (command === 'sync') syncItem(args[0]);
  else if (command === 'validate') validate(args[0]);
  else if (command === 'build-index') buildIndex();
  else if (command === 'check-public') checkPublic();
  else if (command === 'generate') generateImage(args);
  else if (command === 'scan') scanQueue(args);
  else if (command === 'queue') await runQueue(args);
  else if (command === 'scaffold-package') scaffoldPackage(args);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
