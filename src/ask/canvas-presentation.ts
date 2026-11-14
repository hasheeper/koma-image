import { computed, nextTick, onScopeDispose, shallowRef, watch } from 'vue';
import type { ShallowRef } from 'vue';
import type { AppRouter } from '../app/router.ts';
import type { ApplicationServices } from '../services/application.ts';
import { names } from '../storage/names.ts';
import { object } from '../domain/value.ts';

export const canvasRatio = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(.25, Math.min(.45, value)) * 10000) / 10000 : .4;
/** Presentation only: the conversation, board and evolution remain in their original services. */
export function createCanvasPresentation(router: AppRouter, viewport: ShallowRef<number>, preferences: ApplicationServices['preferences'], workspace: 'image' | 'edit' | 'chat' = 'image') {
  const saved = () => object(preferences.get(names.imageLayout, {}));
  const enabled = shallowRef(saved().enabled === true), ratio = shallowRef(canvasRatio(saved().ratio));
  const filmstripOpen = shallowRef(saved().filmstripOpen !== false);
  const compact = computed(() => viewport.value < 1080);
  const eligible = computed(() => router.route.value.workspace === workspace);
  const active = computed(() => enabled.value && eligible.value);
  const askHost = shallowRef<HTMLElement | null>(null), graphHost = shallowRef<HTMLElement | null>(null), actionsHost = shallowRef<HTMLElement | null>(null);
  const historyHost = shallowRef<HTMLElement | null>(null), historyVisible = shallowRef(false);
  const recipeHost = shallowRef<HTMLElement | null>(null);
  const panel = shallowRef<'ask' | 'context' | null>(compact.value ? null : 'ask');
  const recordId = shallowRef<string | null>(null), view = shallowRef<'graph' | 'image' | 'node'>('image');
  const contextKind = computed(() => recordId.value && view.value !== 'image' ? 'recipe' : 'form');
  /* The tray keeps its last pane on screen while it leaves, so display:none
     lands only after the exit; the grid column is released at the same time. */
  const shownPanel = shallowRef(panel.value);
  const trayHeld = computed(() => !!(panel.value || shownPanel.value));
  /* Pre-flush, so a pane set and restored within one tick (docking calls ask.show(), which selects ASK,
     then puts the user's choice back) never sticks: a pane that was never shown has no exit to settle. */
  watch(panel, value => { if (value) shownPanel.value = value; });
  /* Entering BETA or switching workspaces is not a tray gesture: that render settles without motion. */
  const trayMotion = shallowRef(true);
  watch(active, value => {
    trayMotion.value = false;
    /* Phone navigation starts on the canvas; only an explicit pane action covers it. */
    if (value && compact.value) panel.value = null;
    /* Entering or leaving the workspace with the tray closed has no exit in progress: release its column now. */
    if (!panel.value) shownPanel.value = null;
    void nextTick(() => { trayMotion.value = true; });
  }, { flush: 'sync' });
  /* Switching panes while the tray stays open replays one entrance; the marker
     clears afterwards so KeepAlive re-insertion does not replay it. */
  /* Small screens: the phone pane covers the stage (which recedes and pauses). Its head row of
     close / fold / switch can fold into a slim handle to give the pane that height; kept for the page session. */
  const covered = computed(() => active.value && compact.value && !!panel.value);
  const headFolded = shallowRef(false);
  const paneKey = computed(() => panel.value === 'context' ? contextKind.value : panel.value);
  const paneMotion = shallowRef<'a' | 'b' | null>(null);
  let paneTimer: ReturnType<typeof setTimeout> | undefined;
  watch(paneKey, (next, previous) => {
    if (!next || !previous || !active.value) return;
    paneMotion.value = paneMotion.value === 'a' ? 'b' : 'a';
    clearTimeout(paneTimer);
    paneTimer = setTimeout(() => { paneMotion.value = null; }, 400);
  });
  onScopeDispose(() => clearTimeout(paneTimer));
  const sync = () => { enabled.value = saved().enabled === true; ratio.value = canvasRatio(saved().ratio); filmstripOpen.value = saved().filmstripOpen !== false; };
  onScopeDispose(preferences.subscribe(key => { if (!key || key === names.imageLayout) sync(); }));
  async function save() {
    try { await preferences.set(names.imageLayout, { enabled: enabled.value, ratio: ratio.value, filmstripOpen: filmstripOpen.value }); }
    catch { sync(); }
  }
  return { enabled, ratio, filmstripOpen, eligible, active, compact, askHost, graphHost, actionsHost, historyHost, historyVisible, recipeHost, panel, shownPanel, trayHeld, trayMotion, paneMotion, covered, headFolded, contextKind, recordId, view,
    /** Folds or unfolds the phone pane's head row; focus moves to the control that replaces the pressed one. */
    toggleHead(event?: Event) {
      const head = (event?.currentTarget as HTMLElement | null)?.closest('header');
      headFolded.value = !headFolded.value;
      if (head) void nextTick(() => head.querySelector<HTMLElement>(headFolded.value ? '.canvas-head-handle' : '.canvas-fold')?.focus({ preventScroll: true }));
    },
    /** Called once the tray's leave transition has finished (or was skipped). */
    settleTray() { if (!panel.value) shownPanel.value = null; },
    setEnabled(value: boolean) { enabled.value = value; void save(); },
    setFilmstripOpen(value: boolean) { filmstripOpen.value = value; void save(); },
    setRatio(value: number) { ratio.value = canvasRatio(value); void save(); },
  };
}
