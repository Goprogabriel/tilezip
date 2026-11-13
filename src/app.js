import { DEMO_URL, MAX_SLICES, MIN_SLICES, REPOSITORY } from './config.js';
import { getSlices, tileFilename, archiveFilename } from './lib/slices.js';
import { characters, normalizeMessage } from './lib/text.js';
import { loadFile, loadDemo } from './lib/image.js';
import { renderSlice, encodeCanvas, FORMATS } from './lib/render.js';
import { createZip } from './lib/zip.js';

const $ = id => document.getElementById(id);
const state = {
  source: null,
  count: 12,
  text: 'STAY CURIOUS',
  textEnabled: true,
  matchText: true,
  font: 'editorial',
  position: 'top',
  color: '#ffffff',
  textSize: 0.85,
  shadow: true,
  format: 'png',
  quality: 0.94,
  view: 'carousel',
  loading: false,
  exporting: false,
};
let renderFrame = 0;
let sourceVersion = 0;
let noticeTimer;
let downloadUrl;
let exportController;
let dragDepth = 0;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const scroller = $('preview-scroller');
const track = $('slice-track');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

for (const link of document.querySelectorAll('[data-repo-link]')) {
  link.href = `https://github.com/${REPOSITORY}${link.dataset.repoPath ?? ''}`;
}

function maximumCount() {
  return Math.min(MAX_SLICES, state.source?.image.naturalWidth ?? MAX_SLICES);
}

function messageError() {
  if (!state.textEnabled) return '';
  const length = characters(state.text).length;
  if (length > maximumCount()) return `Use up to ${maximumCount()} characters, including spaces.`;
  if (length > state.count) return `Your message needs ${length} slices. Add slices or turn on “Match slices to text”.`;
  return '';
}

function showNotice(message, isError = false) {
  clearTimeout(noticeTimer);
  $('notice-text').textContent = message;
  $('notice').classList.toggle('error', isError);
  $('notice').hidden = false;
  if (!isError) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
}

function clearDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  $('download-again').hidden = true;
  $('download-again').removeAttribute('href');
}

function fillRange(input) {
  const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--fill', `${Number.isFinite(ratio) ? ratio * 100 : 100}%`);
}

function syncUI() {
  const max = maximumCount();
  const letters = characters(state.text);
  const error = messageError();
  $('editor-fields').disabled = state.exporting || state.loading;
  $('reset-button').disabled = state.exporting || state.loading;
  $('preview-panel').setAttribute('aria-busy', String(state.loading));
  $('preview-loading').hidden = !state.loading;
  $('slice-count').value = state.count;
  $('slice-count').max = max;
  $('slice-range').value = state.count;
  $('slice-range').max = max;
  $('slice-range').setAttribute('aria-valuetext', `${state.count} images`);
  $('decrease-count').disabled = state.count <= MIN_SLICES;
  $('increase-count').disabled = state.count >= max;
  $('text-enabled').checked = state.textEnabled;
  $('text-controls').hidden = !state.textEnabled;
  $('match-text').checked = state.matchText;
  if ($('message-input').value !== state.text) $('message-input').value = state.text;
  $('character-count').textContent = `${letters.length}/${state.count}`;
  $('message-input').setAttribute('aria-invalid', String(Boolean(error)));
  $('message-input').parentElement.classList.toggle('invalid', Boolean(error));
  $('message-feedback').textContent = error;
  $('message-feedback').hidden = !error;
  $('text-shadow').checked = state.shadow;
  $('font-style').value = state.font;
  $('text-size').value = state.textSize;
  $('quality').value = state.quality;
  $('quality-output').value = `${Math.round(state.quality * 100)}%`;
  $('quality-setting').hidden = state.format === 'png';
  $('slice-summary').textContent = `${state.count} slices`;
  $('download-button').disabled = state.loading || state.exporting || !state.source || Boolean(error);
  if (!state.exporting) $('download-label').textContent = `Download ${state.count} images`;
  $('export-progress').hidden = !state.exporting;
  $('download-note').hidden = state.exporting;
  $('demo-badge').hidden = !state.source?.isDemo;
  if (state.source) {
    const image = state.source.image;
    $('image-dimensions').textContent = `${image.naturalWidth.toLocaleString('en-US')} × ${image.naturalHeight.toLocaleString('en-US')}`;
    $('source-name').textContent = state.source.isDemo ? 'Or drop one anywhere' : state.source.name;
    $('source-name').title = state.source.isDemo ? 'Try your own image. Or paste one from your clipboard.' : state.source.name;
    $('upload-button').querySelector('span').textContent = state.source.isDemo ? 'Choose an image' : 'Replace image';
  }
  for (const button of document.querySelectorAll('[data-count]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.count) === state.count));
    button.disabled = Number(button.dataset.count) > max;
  }
  for (const key of ['position', 'color', 'format', 'view']) {
    for (const button of document.querySelectorAll(`[data-${key}]`)) {
      button.setAttribute('aria-pressed', String(button.dataset[key] === state[key]));
    }
  }
  for (const input of document.querySelectorAll('.range-input')) fillRange(input);
  scroller.hidden = state.view === 'original';
  scroller.classList.toggle('is-overview', state.view === 'overview');
  scroller.setAttribute('aria-label', state.view === 'overview'
    ? 'All image slices side by side, scaled to fit.'
    : 'Image carousel. Drag, swipe, or use the left and right arrow keys to explore.');
  $('original-view').hidden = state.view !== 'original';
  $('scroll-prev').hidden = state.view !== 'carousel';
  $('scroll-next').hidden = state.view !== 'carousel';
  $('preview-hint').hidden = state.view !== 'carousel';
  $('frame-position').hidden = state.view !== 'carousel';
}

function changed({ resetScroll = false, redraw = true } = {}) {
  clearDownload();
  syncUI();
  if (redraw) scheduleRender(resetScroll);
}

function scheduleRender(resetScroll = false) {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    if (!state.source) return;
    try { renderPreview(resetScroll); }
    catch (error) { showNotice(error.message || 'The preview could not be drawn. Try a smaller image.', true); }
  });
}

function renderPreview(resetScroll) {
  const image = state.source.image;
  const slices = getSlices(image.naturalWidth, image.naturalHeight, state.count);
  const letters = characters(state.text);
  const oldScroll = resetScroll ? 0 : scroller.scrollLeft;
  const fragment = document.createDocumentFragment();
  const previewHeight = Math.min(1000, parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--preview-height')) * Math.min(window.devicePixelRatio || 1, 2));
  for (const slice of slices) {
    const figure = document.createElement('figure');
    figure.className = 'slice-item';
    figure.style.setProperty('--slice-ratio', String(slice.width / slice.height));
    const canvas = renderSlice(image, slice, state, letters[slice.index] ?? '', previewHeight);
    const number = String(slice.index + 1).padStart(2, '0');
    const charDescription = state.textEnabled && letters[slice.index]
      ? (/^\s+$/u.test(letters[slice.index]) ? ', space' : `, character ${letters[slice.index]}`) : '';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Slice ${slice.index + 1} of ${state.count}${charDescription}`);
    const caption = document.createElement('figcaption');
    caption.textContent = number;
    figure.append(canvas, caption);
    fragment.append(figure);
  }
  for (const old of track.querySelectorAll('canvas')) { old.width = 0; old.height = 0; }
  track.replaceChildren(fragment);
  if ($('original-image').src !== state.source.url) $('original-image').src = state.source.url;
  scroller.scrollLeft = oldScroll;
  requestAnimationFrame(updateScrollUI);
}

function updateScrollUI() {
  const maxScroll = scroller.scrollWidth - scroller.clientWidth;
  $('scroll-prev').disabled = scroller.scrollLeft <= 2;
  $('scroll-next').disabled = scroller.scrollLeft >= maxScroll - 2 || maxScroll < 2;
  const children = [...track.children];
  const viewport = scroller.getBoundingClientRect();
  const visible = children.filter(child => {
    const rect = child.getBoundingClientRect();
    return rect.right > viewport.left + 18 && rect.left < viewport.right - 18;
  });
  const first = Math.max(0, children.indexOf(visible[0])) + 1;
  const last = Math.max(first, children.indexOf(visible.at(-1)) + 1);
  $('frame-position').replaceChildren();
  $('frame-position').append(`${String(first).padStart(2, '0')} — ${String(last).padStart(2, '0')} `);
  const total = document.createElement('span');
  total.textContent = `/ ${String(state.count).padStart(2, '0')}`;
  $('frame-position').append(total);
  $('preview-hint').style.opacity = maxScroll > 2 ? '1' : '0';
}

function setCount(value) {
  if (!Number.isFinite(value)) { syncUI(); return; }
  state.count = Math.min(maximumCount(), Math.max(MIN_SLICES, Math.round(value)));
  state.matchText = false;
  changed({ resetScroll: true });
}

function matchCount() {
  if (state.matchText && state.textEnabled) {
    const length = characters(state.text).length;
    if (length > 0) state.count = Math.max(MIN_SLICES, Math.min(maximumCount(), length));
  }
}

async function replaceSource(file = null, reset = false) {
  if (state.exporting) return;
  const version = ++sourceVersion;
  state.loading = true;
  $('notice').hidden = true;
  clearDownload();
  syncUI();
  try {
    const next = file ? await loadFile(file) : await loadDemo(DEMO_URL);
    if (version !== sourceVersion) { next.revoke(); return; }
    const previous = state.source;
    state.source = next;
    if (reset) {
      Object.assign(state, {
        count: 12, text: 'STAY CURIOUS', textEnabled: true, matchText: true,
        font: 'editorial', position: 'top', color: '#ffffff', textSize: 0.85,
        shadow: true, format: 'png', quality: 0.94, view: 'carousel',
      });
      $('text-style-details').open = false;
    }
    state.count = Math.max(MIN_SLICES, Math.min(state.count, maximumCount()));
    matchCount();
    state.loading = false;
    syncUI();
    renderPreview(true);
    previous?.revoke();
    if (file) showNotice('Image ready. It never leaves this browser.');
  } catch (error) {
    if (version !== sourceVersion) return;
    showNotice(error.message || 'The image could not be opened.', true);
  } finally {
    if (version === sourceVersion) { state.loading = false; syncUI(); updateScrollUI(); }
  }
}

async function exportImages() {
  if (state.exporting || state.loading || !state.source || messageError()) return;
  state.exporting = true;
  exportController = new AbortController();
  const { signal } = exportController;
  const source = state.source;
  const settings = { ...state };
  const letters = characters(settings.text);
  const slices = getSlices(source.image.naturalWidth, source.image.naturalHeight, settings.count);
  const entries = [];
  clearDownload();
  $('notice').hidden = true;
  syncUI();
  $('progress-bar').value = 0;
  try {
    for (const slice of slices) {
      signal.throwIfAborted();
      $('download-label').textContent = `Preparing ${slice.index + 1} of ${settings.count}…`;
      await pause();
      const canvas = renderSlice(source.image, slice, settings, letters[slice.index] ?? '');
      try {
        const blob = await encodeCanvas(canvas, settings.format, settings.quality);
        entries.push({ name: tileFilename(slice.index, settings.count, FORMATS[settings.format].extension), blob });
      } finally { canvas.width = 0; canvas.height = 0; }
      $('progress-bar').value = ((slice.index + 1) / settings.count) * 85;
    }
    signal.throwIfAborted();
    $('download-label').textContent = 'Packing your ZIP…';
    const archive = await createZip(entries, {
      signal,
      onProgress: fraction => { $('progress-bar').value = 85 + fraction * 15; },
    });
    signal.throwIfAborted();
    downloadUrl = URL.createObjectURL(archive);
    const link = $('download-again');
    link.href = downloadUrl;
    link.download = archiveFilename(source.name, settings.count);
    link.hidden = false;
    link.click();
    showNotice(`${settings.count} images, ready to go. Upload them in filename order.`);
  } catch (error) {
    if (signal.aborted) showNotice('Export cancelled. Your image is still here.');
    else showNotice(error.message || 'Export failed. Try a smaller image or choose PNG.', true);
  } finally {
    entries.length = 0;
    state.exporting = false;
    exportController = undefined;
    syncUI();
  }
}

$('controls-form').addEventListener('submit', event => { event.preventDefault(); exportImages(); });
// Enter inside a setting must not accidentally start a download.
$('controls-form').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
});
$('upload-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) replaceSource(file);
});
$('reset-button').addEventListener('click', () => replaceSource(null, true));
$('dismiss-notice').addEventListener('click', () => { $('notice').hidden = true; });
$('slice-range').addEventListener('input', event => setCount(Number(event.target.value)));
$('slice-count').addEventListener('input', event => {
  const number = event.target.valueAsNumber;
  if (Number.isFinite(number) && number >= MIN_SLICES && number <= maximumCount()) setCount(number);
});
$('slice-count').addEventListener('change', event => setCount(event.target.valueAsNumber));
$('slice-count').addEventListener('blur', () => syncUI());
$('decrease-count').addEventListener('click', () => setCount(state.count - 1));
$('increase-count').addEventListener('click', () => setCount(state.count + 1));
for (const button of document.querySelectorAll('[data-count]')) {
  button.addEventListener('click', () => setCount(Number(button.dataset.count)));
}
$('message-input').addEventListener('input', event => {
  if (event.isComposing) return;
  state.text = normalizeMessage(event.target.value);
  matchCount();
  changed();
});
$('message-input').addEventListener('compositionend', event => {
  state.text = normalizeMessage(event.target.value);
  matchCount();
  changed();
});
$('text-enabled').addEventListener('change', event => {
  state.textEnabled = event.target.checked;
  matchCount();
  changed();
});
$('match-text').addEventListener('change', event => {
  state.matchText = event.target.checked;
  matchCount();
  changed({ resetScroll: true });
});
$('font-style').addEventListener('change', event => { state.font = event.target.value; changed(); });
$('text-size').addEventListener('input', event => { state.textSize = Number(event.target.value); changed(); });
$('text-shadow').addEventListener('change', event => { state.shadow = event.target.checked; changed(); });
$('quality').addEventListener('input', event => { state.quality = Number(event.target.value); changed({ redraw: false }); });
for (const key of ['position', 'color', 'format']) {
  for (const button of document.querySelectorAll(`[data-${key}]`)) {
    button.addEventListener('click', () => { state[key] = button.dataset[key]; changed(); });
  }
}
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    syncUI();
    requestAnimationFrame(updateScrollUI);
  });
}
$('cancel-export').addEventListener('click', () => exportController?.abort());

function scrollPreview(direction) {
  scroller.scrollBy({ left: direction * scroller.clientWidth * .72, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}
$('scroll-prev').addEventListener('click', () => scrollPreview(-1));
$('scroll-next').addEventListener('click', () => scrollPreview(1));
scroller.addEventListener('scroll', updateScrollUI, { passive: true });
scroller.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    scrollPreview(event.key === 'ArrowLeft' ? -1 : 1);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    scroller.scrollTo({ left: event.key === 'Home' ? 0 : scroller.scrollWidth, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
});
let drag;
scroller.addEventListener('pointerdown', event => {
  if (state.view !== 'carousel' || event.pointerType !== 'mouse' || event.button !== 0) return;
  drag = { x: event.clientX, scroll: scroller.scrollLeft };
  scroller.setPointerCapture(event.pointerId);
  scroller.classList.add('is-dragging');
});
scroller.addEventListener('pointermove', event => {
  if (drag) scroller.scrollLeft = drag.scroll - (event.clientX - drag.x);
});
function stopDrag() { drag = undefined; scroller.classList.remove('is-dragging'); }
scroller.addEventListener('pointerup', stopDrag);
scroller.addEventListener('pointercancel', stopDrag);
scroller.addEventListener('lostpointercapture', stopDrag);
scroller.addEventListener('dragstart', event => event.preventDefault());
new ResizeObserver(() => requestAnimationFrame(updateScrollUI)).observe(scroller);

function isFileDrag(event) { return [...(event.dataTransfer?.types ?? [])].includes('Files'); }
window.addEventListener('dragenter', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  if (!state.exporting) $('drop-overlay').hidden = false;
});
window.addEventListener('dragover', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = state.exporting ? 'none' : 'copy';
});
window.addEventListener('dragleave', event => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('drop-overlay').hidden = true;
});
window.addEventListener('drop', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  if (state.exporting) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) replaceSource(file);
});
window.addEventListener('blur', () => { dragDepth = 0; $('drop-overlay').hidden = true; });
document.addEventListener('paste', event => {
  if (state.exporting) return;
  const item = [...(event.clipboardData?.items ?? [])].find(entry => entry.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) { event.preventDefault(); replaceSource(file); }
});
window.addEventListener('pagehide', event => {
  // Do not revoke resources when the browser puts this page in its back/forward cache.
  if (!event.persisted) { clearDownload(); state.source?.revoke(); exportController?.abort(); }
});

syncUI();
replaceSource();
