import { nextTick } from 'vue';

type Dock = 'off' | 'half' | 'full';
const surfaces: Record<Dock, readonly string[]> = {
  off: ['28px', 'var(--raised)', 'var(--line-2)'],
  half: ['18px', 'var(--chrome)', 'var(--line-2)'],
  full: ['0px', 'var(--canvas)', 'transparent'],
};
const units: readonly [string, string, boolean?][] = [
  ['.home-brand', 'home-brand', true], ['.home-settings', 'home-settings', true],
  ['.home-entries', 'home-entries', true], ['.home-ask', 'home-ask'], ['.home-note', 'home-note', true],
  ['.home-section-head h2', 'home-heading', true], ['.home-slate', 'home-slate', true],
  ['.home-layout', 'home-layout', true], ['.home-face', 'home-face'],
  ['.home-lead-title', 'home-title', true], ['.home-lead-foot', 'home-foot', true],
  ['.home-recent > button', 'home-recent'], ['.home-line', 'home-line'], ['.home-print', 'home-print'],
];
export function createHomeTransitions(measure: () => void = () => {}) {
  let current: { skip: () => void; finish: () => void } | undefined;
  function cancel() { current?.skip(); current?.finish(); current = undefined; }
  function run(kind: string, from: Dock, to: Dock, update: () => void, words = false) {
    cancel();
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      update(); return;
    }
    const html = document.documentElement;
    const named = new Map<HTMLElement, string>();
    const name = (el: HTMLElement | null, value: string, text = false) => {
      if (!el || !el.getClientRects().length) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || rect.bottom <= 0 || rect.top >= innerHeight) return;
      for (const selector of ['.home-progress', '.home-other-lines']) {
        const parent = el.closest(selector)?.getBoundingClientRect();
        if (parent && (rect.left < parent.left - 1 || rect.right > parent.right + 1)) return;
      }
      if (!named.has(el)) named.set(el, el.style.viewTransitionName);
      el.style.viewTransitionName = value;
      if (text) el.style.setProperty('view-transition-class', 'home-text');
    };
    const page = () => {
      for (const [selector, id, text] of units) document.querySelectorAll<HTMLElement>(selector).forEach((el, i) => name(el, `${id}${i ? `-${i}` : ''}`, text));
      name(document.querySelector('.ask-island[data-home]:not([style*="display: none"])'), 'home-ask');
    };
    const oldField = document.querySelector<HTMLTextAreaElement>(from === 'off' ? '.home-ask textarea' : '#askPrompt');
    const carried = words && !!oldField?.value;
    if (carried) name(oldField, 'home-question');
    page();
    const a = [...surfaces[from]], b = [...surfaces[to]];
    if (innerWidth <= 860) { if (from === 'off') a[0] = '25px'; if (to === 'off') b[0] = '25px'; }
    for (const [i, property] of ['r', 'bg', 'ring'].entries()) {
      html.style.setProperty(`--home-vt-${property}0`, a[i]!);
      html.style.setProperty(`--home-vt-${property}1`, b[i]!);
    }
    html.dataset.homeVt = kind;
    let applied = false;
    const commit = () => { if (!applied) { applied = true; update(); } };
    const finish = () => {
      for (const [el, old] of named) { el.style.viewTransitionName = old; el.style.removeProperty('view-transition-class'); }
      named.clear(); delete html.dataset.homeVt;
      for (const key of ['r', 'bg', 'ring']) for (const end of [0, 1]) html.style.removeProperty(`--home-vt-${key}${end}`);
    };
    const transition = document.startViewTransition(async () => {
      commit(); await nextTick();
      // View Transitions suspend rendering: measure synchronously, never wait for rAF here.
      measure(); await nextTick();
      if (current !== owner) return;
      page();
      if (carried) {
        oldField?.style.removeProperty('view-transition-name');
        const questions = document.querySelectorAll<HTMLElement>('.ask-q');
        const destination = to === 'off' ? document.querySelector<HTMLElement>('.home-ask textarea')
          : oldField?.value ? document.querySelector<HTMLElement>('#askPrompt') : questions.item(questions.length - 1);
        name(destination, 'home-question');
      }
    });
    const owner = { skip: () => { transition.skipTransition(); commit(); }, finish };
    current = owner;
    void transition.ready.catch(() => {}); // Superseded or hidden transitions may be skipped.
    void transition.finished.catch(() => {}).finally(() => { if (current === owner) { finish(); current = undefined; } });
  }
  return { cancel, active: () => !!current,
    ask(from: Dock, to: Dock, update: () => void) { run(to === 'off' ? 'close' : 'open', from, to, update, true); },
    flow(update: () => void) { run('flow', 'off', 'off', update); },
  };
}

/** The source and destination must show the same owned original. Cached previews
 * and images outside the visible shelf use the ordinary route change. */
export async function enterWithPicture(source: HTMLImageElement | null, update: () => Promise<void>) {
  const rect = source?.getBoundingClientRect(), shelf = source?.closest('.home-progress, .home-other-lines')?.getBoundingClientRect();
  if (!source || !rect?.width || rect.bottom <= 0 || rect.top >= innerHeight ||
    shelf && (rect.left < shelf.left - 1 || rect.right > shelf.right + 1) ||
    !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { await update(); return; }
  const url = source.currentSrc, name = 'home-picture', previous = source.style.viewTransitionName;
  let destination: HTMLImageElement | undefined;
  source.style.viewTransitionName = name;
  document.documentElement.dataset.homePictureTransition = '';
  const transition = document.startViewTransition(async () => {
    await update(); await nextTick();
    destination = [...document.querySelectorAll<HTMLImageElement>('#image, .chat-print img')]
      .find(el => el.currentSrc === url && el.getClientRects().length > 0);
    if (destination) destination.style.viewTransitionName = name;
  });
  void transition.ready.catch(() => {});
  try { await transition.updateCallbackDone; }
  finally {
    void transition.finished.catch(() => {}).finally(() => {
      source.style.viewTransitionName = previous;
      destination?.style.removeProperty('view-transition-name');
      delete document.documentElement.dataset.homePictureTransition;
    });
  }
}
