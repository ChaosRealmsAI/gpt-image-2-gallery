import './styles.css';

const DATA_URL = './works/index.json';
const LANG_KEY = 'prompt-atlas-lang';
const VIEW_MODE_KEY = 'prompt-atlas-view-mode';
const CATEGORY_KEY = 'prompt-atlas-active-category';

const UI = {
  'zh-CN': {
    all: '全部',
    allTopics: '全部主题',
    empty: '没有匹配的作品。',
    copied: '提示词已复制',
    promptLabel: '提示词',
    copy: '复制',
    series: '合集',
    single: '单图',
    searchPh: '搜索图片、提示词、主题或标签',
    loading: 'Loading...',
    viewModeExpanded: '展开',
    viewModeCollapsed: '封面',
    openOriginal: '新窗口预览',
    download: '下载原图',
    close: '关闭',
    foot: 'GPT Image 2 Hub · AI 生图灵感图鉴',
    random: '随机',
    randomEmpty: '还没有主题可以跳',
    topicAll: '全部主题',
    panelSearchPh: '搜索主题名',
    panelEmpty: '没有匹配的主题',
  },
  en: {
    all: 'All',
    allTopics: 'All Topics',
    empty: 'No matching works.',
    copied: 'Prompt copied',
    promptLabel: 'Prompt',
    copy: 'Copy',
    series: 'Series',
    single: 'Single',
    searchPh: 'Search images, prompts, topics or tags',
    loading: 'Loading...',
    viewModeExpanded: 'All',
    viewModeCollapsed: 'Cover',
    openOriginal: 'Open original',
    download: 'Download',
    close: 'Close',
    foot: 'GPT Image 2 Hub · AI image inspiration atlas',
    random: 'Random',
    randomEmpty: 'No topics to jump to',
    topicAll: 'All Topics',
    panelSearchPh: 'Search topics',
    panelEmpty: 'No matching topics',
  },
};

const LANGS = [
  { id: 'zh-CN' },
  { id: 'en' },
];

const LANG_LABELS = {
  'zh-CN': {
    'zh-CN': '简体中文',
    en: 'Chinese',
  },
  en: {
    'zh-CN': 'English',
    en: 'English',
  },
};

const state = {
  data: null,
  lang: normalizeLang(localStorage.getItem(LANG_KEY) || 'zh-CN'),
  viewMode: localStorage.getItem(VIEW_MODE_KEY) === 'expanded' ? 'expanded' : 'collapsed',
  activeCategory: localStorage.getItem(CATEGORY_KEY) || 'all',
  activeTopic: 'all',
  search: '',
  topicExpanded: false,
  modal: null,
  promptCache: new Map(),
};

let topicMap = new Map();
let packageMap = new Map();
let peersMap = new Map();
let suppressHash = false;

const app = document.querySelector('#app');
const $ = (sel) => document.querySelector(sel);

function normalizeLang(lang) {
  return LANGS.some((item) => item.id === lang) ? lang : 'zh-CN';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function t(key) {
  return (UI[state.lang] || UI['zh-CN'])[key] || UI['zh-CN'][key] || key;
}

function langLabel(langId) {
  return LANG_LABELS[langId]?.[state.lang] || LANG_LABELS[langId]?.en || langId;
}

function localized(item, field) {
  return item?.i18n?.[state.lang]?.[field]
    || item?.i18n?.en?.[field]
    || item?.i18n?.['zh-CN']?.[field]
    || item?.[field]
    || '';
}

function titleOf(image) {
  return localized(image, 'title') || image.title || image.id;
}

function topicLabel(topic) {
  return localized(topic, 'title') || topic?.title || topic?.id || '';
}

function packageLabel(pack) {
  return localized(pack, 'title') || pack?.title || pack?.id || '';
}

function tagLabel(tag) {
  return state.data?.tag_labels?.[tag]?.labels?.[state.lang]
    || state.data?.tag_labels?.[tag]?.labels?.en
    || tag;
}

function categoryDefinition(id) {
  return state.data?.categories?.category?.[id] || null;
}

function categoryLabel(id) {
  const category = categoryDefinition(id);
  return category?.labels?.[state.lang]
    || category?.labels?.en
    || id;
}

function categoryIcon(id) {
  return categoryDefinition(id)?.icon || '';
}

function imageUrl(path) {
  if (!path) return '';
  return `./${String(path).replace(/^\.?\//, '')}`;
}

function imageVariantUrl(path, width) {
  if (!path) return '';
  const withoutExt = String(path).replace(/\.(png|jpg|jpeg|webp)$/i, '');
  return `./${withoutExt.replace(/^\.?\//, '')}.w${width}.webp`;
}

function ratio(value) {
  return String(value || '1:1').replace(':', '/');
}

function hashHue(value) {
  let h = 0;
  for (const char of String(value)) h = (h * 31 + char.charCodeAt(0)) & 0xffff;
  return h % 360;
}

function topicOf(image) {
  return topicMap.get(image.topic_id);
}

function packageKey(image) {
  return `${image.topic_id}/${image.package_id}`;
}

function packageOf(image) {
  return packageMap.get(packageKey(image));
}

function peersOf(image) {
  return peersMap.get(packageKey(image)) || [image];
}

function isSeries(image) {
  return image.type === 'series';
}

function sortTopics(topics) {
  return topics.slice().sort((a, b) => {
    const ao = Number(a.display?.sort_order ?? Number.POSITIVE_INFINITY);
    const bo = Number(b.display?.sort_order ?? Number.POSITIVE_INFINITY);
    if (ao !== bo) return ao - bo;
    return topicLabel(a).localeCompare(topicLabel(b), state.lang);
  });
}

function buildIndexes() {
  topicMap = new Map((state.data?.topics || []).map((topic) => [topic.id, topic]));
  packageMap = new Map(
    (state.data?.packages || []).map((pack) => [`${pack.topic_id}/${pack.id}`, pack]),
  );
  peersMap = new Map();

  for (const image of state.data?.images || []) {
    const key = `${image.topic_id}/${image.package_id}`;
    if (!peersMap.has(key)) peersMap.set(key, []);
    peersMap.get(key).push(image);
  }

  for (const peers of peersMap.values()) {
    peers.sort((a, b) => {
      const ao = Number(a.generation?.order ?? 0);
      const bo = Number(b.generation?.order ?? 0);
      return ao - bo || String(a.id).localeCompare(String(b.id));
    });
  }
}

function shuffleImages(images) {
  for (let i = images.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [images[i], images[j]] = [images[j], images[i]];
  }
}

function topicsWithImages() {
  return (state.data?.topics || []).filter((topic) => Number(topic.image_count || 0) > 0);
}

function categoryExists(id) {
  return id === 'all' || Boolean(categoryDefinition(id));
}

function normalizeCategory(id) {
  return categoryExists(id) ? id : 'all';
}

function topicExists(id) {
  return id === 'all' || topicMap.has(id);
}

function topicMatchesCategory(topicId, categoryId = state.activeCategory) {
  if (topicId === 'all') return true;
  const topic = topicMap.get(topicId);
  if (!topic) return false;
  return categoryId === 'all' || topic.category === categoryId;
}

function currentTopicList() {
  const topics = topicsWithImages();
  if (state.activeCategory === 'all') return sortTopics(topics);
  return sortTopics(topics.filter((topic) => topic.category === state.activeCategory));
}

function categoryImageCount(catId) {
  const images = state.data?.images || [];
  if (catId === 'all') return images.length;
  let n = 0;
  for (const img of images) {
    const topic = topicMap.get(img.topic_id);
    if (topic && topic.category === catId) n += 1;
  }
  return n;
}

function categoryItems() {
  const defs = state.data?.categories?.category || {};
  return [
    {
      id: 'all',
      icon: '✦',
      label: t('allTopics'),
      count: categoryImageCount('all'),
    },
    ...Object.keys(defs).map((id) => ({
      id,
      icon: defs[id]?.icon || '•',
      label: categoryLabel(id),
      count: categoryImageCount(id),
    })),
  ];
}

function syncRouteHash() {
  if (state.modal) return;
  const params = new URLSearchParams();
  if (state.activeCategory !== 'all') params.set('cat', state.activeCategory);
  if (state.activeTopic !== 'all') params.set('t', state.activeTopic);
  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.viewMode === 'expanded') params.set('vm', 'expanded');

  const hash = params.toString() ? `#${params.toString()}` : `${location.pathname}${location.search}`;
  suppressHash = true;
  history.replaceState(null, '', hash);
  suppressHash = false;
}

function renderShell() {
  app.innerHTML = `
    <div class="app">
      <header class="topbar">
        <a class="brand" href="./" aria-label="home">
          <span class="brand-mark"></span>
          <span class="brand-name">GPT Image 2 Hub</span>
        </a>
        <button class="random-btn" id="random-btn" type="button" aria-label="${esc(t('random'))}">
          <span class="random-dice" aria-hidden="true">🎲</span>
          <span class="random-label">${esc(t('random'))}</span>
        </button>
        <div class="top-right">
          <a class="icon-btn" href="https://github.com/ChaosRealmsAI/gpt-image-2-gallery" target="_blank" rel="noopener" aria-label="github">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.55 0-.28-.01-1.02-.02-2-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18A11 11 0 0 1 12 6.8c.98 0 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.73.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.02 2.8-.02 3.18 0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>
          </a>
          <a class="icon-btn" href="https://x.com/WYuxuan60660" target="_blank" rel="noopener" aria-label="x">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <div class="lang-dd" id="lang-dd">
            <button class="lang-dd-trigger" id="lang-dd-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
              <svg class="lang-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span class="lang-dd-label" id="lang-dd-label">${esc(langLabel(state.lang))}</span>
              <svg class="lang-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <ul class="lang-dd-menu" id="lang-dd-menu" role="listbox">
              ${LANGS.map((lang) => `
                <li class="lang-dd-option ${lang.id === state.lang ? 'active' : ''}" data-lang="${esc(lang.id)}" role="option" aria-selected="${lang.id === state.lang}">
                  <span class="lang-dd-dot"></span>
                  <span class="lang-dd-name">${esc(langLabel(lang.id))}</span>
                  ${lang.id === state.lang ? `<svg class="lang-dd-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        </div>
      </header>

      <nav class="cat-row" id="cat-row" aria-label="categories"></nav>

      <div class="topic-row-wrap">
        <div class="topic-row" id="topic-row" aria-label="topics"></div>
        <button class="topic-all-btn" id="topic-all-btn" type="button" hidden>
          <span id="topic-all-label"></span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div class="detail-bar">
        <div class="detail-left">
          <span class="detail-title" id="detail-title"></span>
          <span class="detail-count" id="detail-count"></span>
        </div>
        <div class="detail-right">
          <div class="view-mode" id="view-mode-group" role="radiogroup" aria-label="view mode">
            <button class="vm-btn ${state.viewMode === 'collapsed' ? 'active' : ''}" data-mode="collapsed" type="button" role="radio" aria-checked="${state.viewMode === 'collapsed'}">${esc(t('viewModeCollapsed'))}</button>
            <button class="vm-btn ${state.viewMode === 'expanded' ? 'active' : ''}" data-mode="expanded" type="button" role="radio" aria-checked="${state.viewMode === 'expanded'}">${esc(t('viewModeExpanded'))}</button>
          </div>
        </div>
      </div>

      <main class="waterfall" id="waterfall" aria-label="works"></main>
      <div class="foot">${esc(t('foot'))}</div>
    </div>

    <div class="modal-scrim" id="scrim" aria-hidden="true">
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" id="m-close" type="button" aria-label="${esc(t('close'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="modal-media">
          <img id="m-img" alt="" />
          <button class="nav-arrow prev" id="m-prev" type="button" aria-label="prev">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="nav-arrow next" id="m-next" type="button" aria-label="next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="modal-side">
          <div class="modal-eyebrow" id="m-eyebrow">
            <span class="dot"></span>
            <span id="m-eyebrow-text"></span>
            <span class="pos" id="m-pos"></span>
            <div class="series-dots" id="m-dots"></div>
          </div>
          <h1 class="modal-title" id="m-title"></h1>
          <div class="modal-pills" id="m-pills"></div>
          <div class="tag-cloud" id="m-tags"></div>
          <div class="prompt-head">
            <span class="prompt-label" id="m-prompt-label">${esc(t('promptLabel'))}</span>
            <button class="copy-big" id="m-copy" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span id="m-copy-label">${esc(t('copy'))}</span>
            </button>
          </div>
          <pre class="prompt-text" id="m-prompt"></pre>
          <div class="modal-actions">
            <a class="modal-action" id="m-open" href="#" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span id="m-open-label">${esc(t('openOriginal'))}</span>
            </a>
            <a class="modal-action" id="m-download" download>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span id="m-download-label">${esc(t('download'))}</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="toast" id="toast">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      <span id="toast-text">${esc(t('copied'))}</span>
    </div>
  `;
}

function renderCategoryRow() {
  const row = $('#cat-row');
  if (!row) return;
  row.innerHTML = categoryItems().map((item) => `
    <button class="cat-chip ${item.id === state.activeCategory ? 'active' : ''}" data-category="${esc(item.id)}" type="button">
      <span class="cat-icon">${esc(item.icon)}</span>
      <span class="cat-label">${esc(item.label)}</span>
      <span class="cat-count">${item.count}</span>
    </button>
  `).join('');
}

function renderTopicRow() {
  const row = $('#topic-row');
  const btn = $('#topic-all-btn');
  const btnLabel = $('#topic-all-label');
  if (!row) return;

  const items = currentTopicList();
  const allLabel = state.activeCategory === 'all'
    ? t('topicAll')
    : `${categoryIcon(state.activeCategory)} ${categoryLabel(state.activeCategory)}`.trim();
  const allCount = categoryImageCount(state.activeCategory);

  row.innerHTML = `
    <button class="topic-chip topic-chip-all ${state.activeTopic === 'all' ? 'active' : ''}" data-topic="all" type="button">
      <span>${esc(allLabel)}</span>
      <span class="topic-count">${allCount}</span>
    </button>
    ${items.map((topic) => `
      <button class="topic-chip ${topic.id === state.activeTopic ? 'active' : ''}" data-topic="${esc(topic.id)}" type="button">
        <span>${esc(topicLabel(topic))}</span>
        <span class="topic-count">${Number(topic.image_count || 0)}</span>
      </button>
    `).join('')}
  `;

  row.classList.toggle('expanded', state.topicExpanded);

  if (btn && btnLabel) {
    btn.classList.toggle('expanded', state.topicExpanded);
    if (state.topicExpanded) {
      btnLabel.textContent = state.lang === 'zh-CN' ? '收起' : 'Collapse';
    } else {
      btnLabel.textContent = state.lang === 'zh-CN'
        ? `全部 ${items.length}`
        : `All ${items.length}`;
    }
  }

  requestAnimationFrame(() => checkTopicOverflow());
}

function checkTopicOverflow() {
  const row = $('#topic-row');
  const btn = $('#topic-all-btn');
  if (!row || !btn) return;
  if (state.topicExpanded) {
    btn.hidden = false;
    row.classList.remove('has-more');
    return;
  }
  const overflow = row.scrollHeight > row.clientHeight + 1;
  btn.hidden = !overflow;
  row.classList.toggle('has-more', overflow);
}

function toggleTopicExpand() {
  state.topicExpanded = !state.topicExpanded;
  renderTopicRow();
}

function activeFilterLabel() {
  if (state.activeTopic !== 'all') {
    return topicLabel(topicMap.get(state.activeTopic));
  }
  if (state.activeCategory !== 'all') {
    return `${categoryIcon(state.activeCategory)} ${categoryLabel(state.activeCategory)}`.trim();
  }
  return t('allTopics');
}

function renderDetailBar() {
  const titleEl = $('#detail-title');
  const countEl = $('#detail-count');
  if (!titleEl || !countEl) return;
  titleEl.textContent = activeFilterLabel();
  countEl.textContent = filteredImages().length;
}

function renderViewModeGroup() {
  const group = $('#view-mode-group');
  if (!group) return;
  group.querySelectorAll('.vm-btn').forEach((button) => {
    const active = button.dataset.mode === state.viewMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

function filteredImages() {
  const q = state.search.trim().toLowerCase();
  const images = (state.data?.images || []).filter((image) => {
    const topic = topicOf(image);
    if (!topic) return false;
    if (state.activeCategory !== 'all' && topic.category !== state.activeCategory) return false;
    if (state.activeTopic !== 'all' && image.topic_id !== state.activeTopic) return false;
    if (!q) return true;

    const pack = packageOf(image);
    const hay = [
      titleOf(image),
      packageLabel(pack),
      topicLabel(topic),
      ...(state.lang === 'en' ? [image.image_id || image.id] : []),
      ...(image.tags || []).map((tag) => `${tag} ${tagLabel(tag)}`),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (state.viewMode !== 'collapsed') return images;

  const seenSeries = new Set();
  return images.reduce((acc, image) => {
    if (!isSeries(image) || !image.package_id) {
      acc.push(image);
      return acc;
    }
    if (seenSeries.has(image.package_id)) return acc;
    seenSeries.add(image.package_id);
    acc.push(peersOf(image)[0] || image);
    return acc;
  }, []);
}

function renderCard(image) {
  const peers = isSeries(image) ? peersOf(image) : null;
  const primaryTitle = titleOf(image);
  const packageTitle = packageLabel(packageOf(image));
  const isCollapsedSeries = peers && peers.length > 1 && state.viewMode === 'collapsed';
  return `
    <article class="card ${isCollapsedSeries ? 'is-stack' : ''}" data-id="${esc(image.id)}" style="--hue:${hashHue(image.id)}">
      ${isCollapsedSeries ? '<span class="stack-layer stack-2" aria-hidden="true"></span><span class="stack-layer stack-1" aria-hidden="true"></span>' : ''}
      <div class="cover" style="--ar:${ratio(image.aspect_ratio)}">
        <img src="${esc(imageVariantUrl(image.image, 400))}" srcset="${esc(imageVariantUrl(image.image, 400))} 400w, ${esc(imageVariantUrl(image.image, 1600))} 1600w" sizes="(max-width: 720px) 50vw, (max-width: 1280px) 33vw, 400px" alt="${esc(image.display?.alt?.[state.lang] || primaryTitle)}" loading="lazy" decoding="async" onerror="this.classList.add('failed')" />
        <div class="cover-placeholder">🎨</div>
        ${peers && peers.length > 1 ? `
          <span class="series-badge" title="${esc(`${packageTitle} · ${peers.length}`)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V9"/></svg>
            <span class="n">${esc(t('series'))} · ${peers.length}</span>
          </span>
        ` : ''}
        <div class="card-overlay">
          <div class="card-title">${esc(primaryTitle)}</div>
        </div>
        <button class="mini-btn" data-copy="${esc(image.id)}" type="button" title="${esc(t('copy'))}" aria-label="${esc(t('copy'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
    </article>
  `;
}

function renderGallery() {
  const waterfall = $('#waterfall');
  if (!waterfall) return;
  const list = filteredImages();
  if (!list.length) {
    waterfall.innerHTML = `<div class="empty">${esc(t('empty'))}</div>`;
    return;
  }
  waterfall.innerHTML = list.map(renderCard).join('');
}

function randomJump() {
  const topics = topicsWithImages();
  if (!topics.length) {
    showToast(t('randomEmpty'));
    return;
  }
  let candidates = topics;
  if (topics.length > 1 && state.activeTopic !== 'all') {
    candidates = topics.filter((topic) => topic.id !== state.activeTopic);
    if (!candidates.length) candidates = topics;
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const btn = $('#random-btn');
  if (btn) {
    btn.classList.remove('spin');
    void btn.offsetWidth;
    btn.classList.add('spin');
  }
  setActiveTopic(pick.id, { scrollTop: true });
}

async function loadPrompt(image) {
  if (!image) return '';
  if (state.promptCache.has(image.id)) return state.promptCache.get(image.id);
  try {
    const response = await fetch(imageUrl(image.meta_path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const meta = await response.json();
    const prompt = meta.prompt || '';
    state.promptCache.set(image.id, prompt);
    return prompt;
  } catch {
    const message = `Unable to load prompt from ${image.meta_path}`;
    state.promptCache.set(image.id, message);
    return message;
  }
}

function imageById(id) {
  return (state.data?.images || []).find((image) => image.id === id);
}

async function openModal(id, options = {}) {
  const image = imageById(id);
  if (!image) return;

  state.modal = image;
  const topic = topicOf(image);
  const peers = isSeries(image) ? peersOf(image) : null;
  const primaryTitle = titleOf(image);
  const modalSrc = imageVariantUrl(image.image, 1600);
  const hdSrc = imageVariantUrl(image.image, 2400);

  $('#m-img').src = modalSrc;
  $('#m-img').alt = image.display?.alt?.[state.lang] || primaryTitle;

  if (peers && peers.length > 1) {
    const idx = Math.max(0, peers.findIndex((p) => p.id === image.id));
    const neighbors = new Set([
      peers[(idx - 1 + peers.length) % peers.length],
      peers[(idx + 1) % peers.length],
    ]);
    setTimeout(() => {
      for (const peer of neighbors) {
        if (peer.id === image.id) continue;
        const preImg = new Image();
        preImg.decoding = 'async';
        preImg.src = imageVariantUrl(peer.image, 1600);
        if (!state.promptCache.has(peer.id)) loadPrompt(peer);
      }
    }, 300);
  }

  $('#m-title').textContent = primaryTitle;
  $('#m-prompt').textContent = state.promptCache.get(image.id) || t('loading');
  $('#m-open').href = hdSrc;
  $('#m-download').href = hdSrc;
  $('#m-download').setAttribute('download', `${image.image_id || image.id.split('/').pop() || 'image'}.webp`);
  $('#m-prompt-label').textContent = t('promptLabel');
  $('#m-copy-label').textContent = t('copy');

  $('#m-eyebrow-text').textContent = topicLabel(topic);
  const posEl = $('#m-pos');
  const dotsEl = $('#m-dots');
  const prevEl = $('#m-prev');
  const nextEl = $('#m-next');

  if (peers && peers.length > 1) {
    const index = Math.max(0, peers.findIndex((peer) => peer.id === image.id));
    posEl.textContent = `${index + 1} / ${peers.length}`;
    posEl.style.display = '';
    dotsEl.classList.add('show');
    dotsEl.innerHTML = peers.map((peer, i) => `<button class="dot ${i === index ? 'active' : ''}" data-id="${esc(peer.id)}" type="button" aria-label="${i + 1}/${peers.length}"></button>`).join('');
    prevEl.classList.add('show');
    nextEl.classList.add('show');
  } else {
    posEl.textContent = '';
    posEl.style.display = 'none';
    dotsEl.classList.remove('show');
    dotsEl.innerHTML = '';
    prevEl.classList.remove('show');
    nextEl.classList.remove('show');
  }

  $('#m-pills').innerHTML = `
    <span class="m-pill m-pill-topic">● ${esc(topicLabel(topic))}</span>
    <span class="m-pill m-pill-aspect">${esc(image.aspect_ratio || '1:1')}</span>
    <span class="m-pill m-pill-type">${esc(isSeries(image) ? t('series') : t('single'))}</span>
  `;
  $('#m-tags').innerHTML = (image.tags || []).map((tag) => `<span class="tag-chip">#${esc(tagLabel(tag))}</span>`).join('');

  $('#scrim').classList.add('open');
  $('#scrim').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  if (!options.fromHash) {
    suppressHash = true;
    history.replaceState(null, '', `#m-${encodeURIComponent(image.id)}`);
    suppressHash = false;
  }

  const prompt = await loadPrompt(image);
  if (state.modal?.id === image.id) $('#m-prompt').textContent = prompt;
}

function closeModal(options = {}) {
  $('#scrim')?.classList.remove('open');
  $('#scrim')?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  state.modal = null;

  if (!options.keepHash && location.hash.startsWith('#m-')) {
    syncRouteHash();
  }
}

function navModal(delta) {
  if (!state.modal || !isSeries(state.modal)) return;
  const peers = peersOf(state.modal);
  if (peers.length <= 1) return;
  const index = Math.max(0, peers.findIndex((peer) => peer.id === state.modal.id));
  const next = peers[(index + delta + peers.length) % peers.length];
  openModal(next.id);
}

function showToast(message) {
  const toast = $('#toast');
  $('#toast-text').textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__promptAtlasToast);
  window.__promptAtlasToast = setTimeout(() => toast.classList.remove('show'), 2000);
}

async function copyPromptFor(image) {
  if (!image) return;
  const prompt = await loadPrompt(image);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = prompt;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  showToast(t('copied'));
}

function renderAll() {
  renderShell();
  renderCategoryRow();
  renderTopicRow();
  renderDetailBar();
  renderGallery();
}

function applyLang() {
  document.documentElement.lang = state.lang;
  localStorage.setItem(LANG_KEY, state.lang);
  renderAll();
  if (state.modal) openModal(state.modal.id);
}

function setActiveCategory(id, options = {}) {
  const next = normalizeCategory(id);
  if (!options.keepTopic && !topicMatchesCategory(state.activeTopic, next)) {
    state.activeTopic = 'all';
  }
  state.activeCategory = next;
  localStorage.setItem(CATEGORY_KEY, next);
  renderCategoryRow();
  renderTopicRow();
  renderDetailBar();
  renderGallery();
  if (options.scrollTop) window.scrollTo(0, 0);
  if (options.updateHash !== false) syncRouteHash();
  return true;
}

function setActiveTopic(id, options = {}) {
  if (!topicExists(id)) return false;
  if (id === 'all') {
    state.activeTopic = 'all';
    renderCategoryRow();
    renderTopicRow();
    renderDetailBar();
    renderGallery();
    if (options.scrollTop) window.scrollTo(0, 0);
    if (options.updateHash !== false) syncRouteHash();
    return true;
  }

  const topic = topicMap.get(id);
  const nextCategory = normalizeCategory(topic?.category || 'all');
  state.activeCategory = nextCategory;
  state.activeTopic = id;
  localStorage.setItem(CATEGORY_KEY, nextCategory);
  renderCategoryRow();
  renderTopicRow();
  renderDetailBar();
  renderGallery();
  if (options.scrollTop) window.scrollTo(0, 0);
  if (options.updateHash !== false) syncRouteHash();
  return true;
}

function applyHashRoute() {
  const hash = location.hash || '';

  if (hash.startsWith('#m-')) {
    openModal(decodeURIComponent(hash.slice(3)), { fromHash: true });
    return;
  }

  if (hash.startsWith('#t-')) {
    closeModal({ keepHash: true });
    const topicId = decodeURIComponent(hash.slice(3).split('/')[0] || '');
    setActiveTopic(topicId, { scrollTop: true, updateHash: true });
    return;
  }
  if (hash.startsWith('#c-')) {
    closeModal({ keepHash: true });
    const categoryId = decodeURIComponent(hash.slice(3).split('/')[0] || '');
    setActiveCategory(categoryId, { scrollTop: true, updateHash: true });
    return;
  }

  if (hash.startsWith('#') && hash.length > 1) {
    const params = new URLSearchParams(hash.slice(1));
    closeModal({ keepHash: true });

    const nextCat = normalizeCategory(params.get('cat') || 'all');
    state.activeCategory = nextCat;
    localStorage.setItem(CATEGORY_KEY, nextCat);

    const tid = params.get('t') || 'all';
    state.activeTopic = topicExists(tid) ? tid : 'all';

    state.search = params.get('q') || '';
    state.viewMode = params.get('vm') === 'expanded' ? 'expanded' : 'collapsed';
    localStorage.setItem(VIEW_MODE_KEY, state.viewMode);

    renderAll();
    return;
  }

  closeModal({ keepHash: true });
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const catChip = event.target.closest('.cat-chip');
    if (catChip) {
      setActiveCategory(catChip.dataset.category, { scrollTop: true });
      return;
    }

    const topicChip = event.target.closest('.topic-chip');
    if (topicChip) {
      setActiveTopic(topicChip.dataset.topic, { scrollTop: true });
      return;
    }

    if (event.target.closest('#topic-all-btn')) {
      toggleTopicExpand();
      return;
    }

    if (event.target.closest('#random-btn')) {
      randomJump();
      return;
    }

    const viewModeButton = event.target.closest('.vm-btn');
    if (viewModeButton) {
      const mode = viewModeButton.dataset.mode === 'expanded' ? 'expanded' : 'collapsed';
      if (mode !== state.viewMode) {
        state.viewMode = mode;
        localStorage.setItem(VIEW_MODE_KEY, mode);
        renderViewModeGroup();
        renderDetailBar();
        renderGallery();
        syncRouteHash();
      }
      return;
    }

    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      event.stopPropagation();
      copyPromptFor(imageById(copyButton.dataset.copy));
      return;
    }

    const card = event.target.closest('.card');
    if (card) {
      openModal(card.dataset.id);
      return;
    }

    if (event.target.closest('#m-close')) {
      closeModal();
      return;
    }

    if (event.target.closest('#m-prev')) {
      navModal(-1);
      return;
    }

    if (event.target.closest('#m-next')) {
      navModal(1);
      return;
    }

    const dot = event.target.closest('#m-dots .dot');
    if (dot) {
      openModal(dot.dataset.id);
      return;
    }

    if (event.target.closest('#m-copy')) {
      copyPromptFor(state.modal);
      return;
    }

    if (event.target.id === 'scrim') {
      closeModal();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'search') {
      state.search = event.target.value;
      renderDetailBar();
      renderGallery();
      syncRouteHash();
      return;
    }
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('#lang-dd-trigger');
    const dd = $('#lang-dd');
    if (trigger && dd) {
      const open = dd.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(open));
      return;
    }
    const option = event.target.closest('.lang-dd-option');
    if (option) {
      state.lang = normalizeLang(option.dataset.lang);
      applyLang();
      return;
    }
    if (dd && !event.target.closest('#lang-dd')) {
      dd.classList.remove('open');
      $('#lang-dd-trigger')?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (state.modal) {
      if (event.key === 'Escape') { closeModal(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); navModal(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); navModal(1); return; }
    }
    if (state.topicExpanded && event.key === 'Escape') {
      toggleTopicExpand();
    }
  });

  window.addEventListener('resize', () => requestAnimationFrame(checkTopicOverflow));

  window.addEventListener('hashchange', () => {
    if (suppressHash) return;
    applyHashRoute();
  });
}

async function boot() {
  renderLoading();
  bindEvents();
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state.data = await response.json();
  buildIndexes();
  shuffleImages(state.data.images || []);
  state.activeCategory = normalizeCategory(state.activeCategory);
  if (!topicMatchesCategory(state.activeTopic, state.activeCategory)) state.activeTopic = 'all';
  applyLang();
  applyHashRoute();
}

function renderLoading() {
  app.innerHTML = '<div class="app"><main class="waterfall"><div class="empty">Loading...</div></main></div>';
}

boot().catch((error) => {
  console.error(error);
  app.innerHTML = '<div class="app"><main class="waterfall"><div class="empty">Unable to load works/index.json</div></main></div>';
});
