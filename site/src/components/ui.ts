// Global, delegated UI behaviour for every page. Layout.astro calls initUI() once.
// Pages never re-implement these; they only emit the markup hooks listed in /tmp/site-redesign/foundation.md.
//   [data-tip]                tooltip / tap popover (NotPublished, dashes, any short explanation)
//   [data-copy] [data-copy-from]  copy to clipboard + toast (CopyButton, CopyField, CodeBlock)
//   [data-download-from]      save an element's text as a file (data-download-filename names it)
//   [data-wrap-toggle]        CodeBlock wrap toggle; [data-fold-toggle] CodeBlock fold toggle
//   tr[data-href]             whole-row link (clicks on links/buttons/inputs inside the row are left alone)
//   .sn[aria-expanded]        StatusNotice tap-to-expand (only while its text is cut off; see syncNotice)
//   .nav-links, .chips        right-edge fade only while more items are scrolled out of view
//   window.showToast(message, type?, duration?)

type ToastType = 'success' | 'error' | 'info' | 'warning';
const ICONS: Record<ToastType, string> = {
  success: '<path d="m5 12 5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warning: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>',
  error: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const DURATIONS: Record<ToastType, number> = { success: 2200, info: 2600, warning: 3000, error: 4000 };

export function showToast(message: string, type: ToastType = 'success', duration?: number) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const kind: ToastType = type in ICONS ? type : 'info';
  const existing = container.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind} toast-enter`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  // Icon markup is a constant; the message is set as text.
  toast.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${kind === 'success' ? 3 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg><span></span>`;
  toast.querySelector('span')!.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.replace('toast-enter', 'toast-leave');
    window.setTimeout(() => toast.remove(), 150);
  }, duration ?? DURATIONS[kind]);
}

function selectText(el: Element) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch { /* ignore */ }
}

/** Copy text, toast on success; when the clipboard is blocked, select `fallbackEl` and explain. */
export async function copyText(text: string, okMessage = 'Copied', fallbackEl?: Element | null) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    showToast(okMessage, 'success');
  } catch {
    if (fallbackEl) selectText(fallbackEl);
    showToast('Copy is blocked here. The text is selected; press Ctrl+C or ⌘C.', 'info');
  }
}

/* ---------- tooltip ---------- */
let tip: HTMLElement | null = null;
let tipFor: HTMLElement | null = null;
function showTip(el: HTMLElement) {
  if (!tip) return;
  tipFor = el;
  tip.textContent = el.dataset.tip ?? '';
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 8) top = r.top - th - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideTip() { if (tip) tip.hidden = true; tipFor = null; }

/* ---------- code blocks ---------- */
const COMMENT = /^\s*(#|\/\/)/;
function fillCode(codeEl: HTMLElement, code: string) {
  const lines = code.split('\n');
  codeEl.replaceChildren(...lines.map((line, i) => {
    const text = line + (i < lines.length - 1 ? '\n' : '');
    if (!COMMENT.test(line)) return document.createTextNode(text);
    const span = document.createElement('span');
    span.className = 'c';
    span.textContent = text;
    return span;
  }));
  return lines.length;
}

/** Replace the code of a CodeBlock (by its `id`), keeping fold state and the "Show full file" label in sync. */
export function setCodeBlock(id: string, code: string) {
  const codeEl = document.getElementById(id);
  if (!codeEl) return;
  const count = fillCode(codeEl, code);
  const block = codeEl.closest<HTMLElement>('[data-code-block]');
  const foldLines = Number(block?.dataset.foldLines);
  if (!block || !foldLines) return;
  const more = block.querySelector<HTMLElement>('.code-more');
  const button = block.querySelector<HTMLButtonElement>('[data-fold-toggle]');
  const foldable = count > foldLines;
  const expanded = button?.getAttribute('aria-expanded') === 'true';
  block.classList.toggle('folded', foldable && !expanded);
  if (more) more.hidden = !foldable;
  if (button) button.textContent = expanded ? 'Show less' : `Show full file (${count} lines)`;
}

function setWrap(block: HTMLElement, on: boolean) {
  block.classList.toggle('wrapped', on);
  block.querySelector('[data-wrap-toggle]')?.setAttribute('aria-pressed', String(on));
}

/* ---------- chips ---------- */
/**
 * Update a Chip on the client. A chip with count 0 that is not pressed becomes disabled.
 * hideIfTotal: hide the chip when its count equals this total and it is not pressed (the filter would change nothing).
 */
export function setChip(chip: HTMLElement, opts: { count?: number | null; pressed?: boolean; hideIfTotal?: number }) {
  // A count of 0 keeps the chip, disabled; it is hidden only when it would match every one of a non-empty set.
  const pressed = opts.pressed ?? chip.getAttribute('aria-pressed') === 'true';
  chip.setAttribute('aria-pressed', String(pressed));
  const countEl = chip.querySelector('[data-chip-count]');
  if (opts.count != null && countEl) countEl.textContent = String(opts.count);
  const disabled = opts.count === 0 && !pressed;
  if (disabled) { chip.setAttribute('aria-disabled', 'true'); chip.tabIndex = -1; }
  else { chip.removeAttribute('aria-disabled'); chip.removeAttribute('tabindex'); }
  chip.hidden = opts.hideIfTotal != null && opts.hideIfTotal > 0 && opts.count === opts.hideIfTotal && !pressed;
}
/** True unless the chip is aria-disabled. Check this in chip click handlers. */
export const chipEnabled = (chip: Element) => chip.getAttribute('aria-disabled') !== 'true';

/* ---------- status notice: a button only while its text is truncated ---------- */
function syncNotice(sn: HTMLElement) {
  if (sn.getAttribute('aria-expanded') === 'true') return;
  const text = sn.querySelector<HTMLElement>('.sn-text');
  const cut = !!text && text.scrollWidth > text.clientWidth + 1;
  if (cut) {
    sn.setAttribute('role', 'button');
    sn.tabIndex = 0;
    sn.setAttribute('aria-expanded', 'false');
  } else {
    sn.removeAttribute('role');
    sn.removeAttribute('tabindex');
    sn.removeAttribute('aria-expanded');
  }
}

/* ---------- horizontal scrollers: fade the right edge only while there is more ---------- */
function syncScrollEnd(el: HTMLElement) {
  el.classList.toggle('scroll-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
}

/* ---------- init ---------- */
let initialized = false;
export function initUI() {
  if (initialized) return;
  initialized = true;
  window.showToast = showToast;
  tip = document.getElementById('tip');

  const narrow = window.matchMedia('(max-width: 639px)');
  document.querySelectorAll<HTMLElement>('[data-code-block][data-wrap="auto"]').forEach(b => setWrap(b, narrow.matches));

  const notices = Array.from(document.querySelectorAll<HTMLElement>('.sn[data-status-notice]'));
  const scrollers = Array.from(document.querySelectorAll<HTMLElement>('.nav-links, .chips'));
  // The current page's nav link starts in view (Paid rates is last and would sit under the fade).
  const nav = document.querySelector<HTMLElement>('.nav-links');
  const current = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
  const revealCurrent = () => {
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    // Bring it clear of the fade (the last 15% of the row); scrollLeft clamps at the end.
    const over = current.getBoundingClientRect().right - (nav.getBoundingClientRect().right - nav.clientWidth * 0.15);
    if (over > 0) nav.scrollLeft += Math.ceil(over);
    syncScrollEnd(nav);
  };
  revealCurrent();
  const syncAll = () => { notices.forEach(syncNotice); scrollers.forEach(syncScrollEnd); };
  scrollers.forEach(el => el.addEventListener('scroll', () => syncScrollEnd(el), { passive: true }));
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(syncAll);
    notices.forEach(n => ro.observe(n));
    scrollers.forEach(el => ro.observe(el));
  }
  // status-client rewrites the notice text; filters hide and show chips.
  const mo = new MutationObserver(syncAll);
  notices.forEach(n => mo.observe(n, { childList: true, subtree: true, characterData: true }));
  scrollers.forEach(el => mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }));
  window.addEventListener('resize', syncAll, { passive: true });
  syncAll();
  // Web fonts change the row widths, so measure again once they are in.
  document.fonts?.ready.then(() => { revealCurrent(); syncAll(); }).catch(() => {});

  // Chrome leaves a partly visible item where it is when it gets focus; show all of it.
  scrollers.forEach(el => el.addEventListener('focusin', event => {
    const item = event.target as HTMLElement;
    if (item === el || !el.contains(item)) return;
    const box = el.getBoundingClientRect(), r = item.getBoundingClientRect();
    if (r.left < box.left) el.scrollLeft -= box.left - r.left + 4;
    else if (r.right > box.right) el.scrollLeft += r.right - box.right + 28;
  }));

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const sn = (event.target as Element | null)?.closest?.<HTMLElement>('.sn[aria-expanded]');
    if (!sn || event.target !== sn) return;
    event.preventDefault();
    sn.click();
  });

  document.addEventListener('click', event => {
    const target = event.target as Element | null;
    if (!target?.closest) return;

    const tipEl = target.closest<HTMLElement>('[data-tip]');
    if (tipEl) { event.preventDefault(); event.stopPropagation(); showTip(tipEl); return; }
    hideTip();

    const notice = target.closest<HTMLElement>('.sn[aria-expanded]');
    if (notice) {
      const open = notice.getAttribute('aria-expanded') !== 'true';
      notice.setAttribute('aria-expanded', String(open));
      if (!open) syncNotice(notice);
      return;
    }

    const copyEl = target.closest<HTMLElement>('[data-copy], [data-copy-from]');
    if (copyEl) {
      event.preventDefault();
      const src = copyEl.dataset.copyFrom ? document.getElementById(copyEl.dataset.copyFrom) : null;
      const text = src ? src.textContent ?? '' : copyEl.dataset.copy ?? '';
      void copyText(text, copyEl.dataset.copyToast || 'Copied', src ?? copyEl.closest('.cf-b, .idcell, .idline')?.querySelector('.cf-v, .mono'));
      return;
    }

    const dl = target.closest<HTMLElement>('[data-download-from]');
    if (dl) {
      const text = document.getElementById(dl.dataset.downloadFrom ?? '')?.textContent ?? '';
      const filename = dl.dataset.downloadFilename || 'download.txt';
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`${filename} downloaded`, 'success');
      return;
    }

    const wrap = target.closest<HTMLElement>('[data-wrap-toggle]');
    if (wrap) {
      const block = wrap.closest<HTMLElement>('[data-code-block]');
      if (block) setWrap(block, !block.classList.contains('wrapped'));
      return;
    }

    const fold = target.closest<HTMLButtonElement>('[data-fold-toggle]');
    if (fold) {
      const block = fold.closest<HTMLElement>('[data-code-block]');
      const expanded = fold.getAttribute('aria-expanded') !== 'true';
      fold.setAttribute('aria-expanded', String(expanded));
      block?.classList.toggle('folded', !expanded);
      const lines = (block?.querySelector('code')?.textContent ?? '').split('\n').length;
      fold.textContent = expanded ? 'Show less' : `Show full file (${lines} lines)`;
      return;
    }

    const row = target.closest<HTMLElement>('tr[data-href]');
    if (row && !target.closest('a, button, input, select, textarea, label, summary')) {
      const href = row.dataset.href!;
      if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener');
      else location.href = href;
    }
  });

  document.addEventListener('mouseover', e => { const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('mouseout', e => {
    const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
    if (el && !el.contains(e.relatedTarget as Node | null)) hideTip();
  });
  document.addEventListener('focusin', e => { const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]'); if (el) showTip(el); else hideTip(); });
  document.addEventListener('focusout', e => { if ((e.target as Element).closest?.('[data-tip]')) hideTip(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('scroll', () => {
    if (!tipFor) return;
    if (tipFor === document.activeElement && tipFor.isConnected) showTip(tipFor); else hideTip();
  }, { passive: true });
}
