import { inject, nextTick, onScopeDispose } from 'vue';
import type { InjectionKey } from 'vue';
import type { AppRouter } from '../app/router.ts';
import type { Home } from './service.ts';
import type { Drawing } from '../services/drawing.ts';
import type { Chat } from '../services/chat.ts';
import type { Editor } from '../services/editor.ts';
import type { Ui } from '../app/ui.ts';
import { message } from '../app/ui.ts';
import type { HomeLine, HomePicture } from './derive.ts';

export function createHomeNavigation(deps: { router: AppRouter; home: Home; drawing: Drawing; chat: Chat; editor: Editor; ui: Ui }) {
  const { router, home, drawing, chat, editor, ui } = deps;
  async function enter(line: HomeLine, picture?: HomePicture) {
    if (line.workspace === 'image') {
      if (!drawing.board(line.sourceId)) throw new Error('画板已删除');
      await drawing.switchBoard(line.sourceId);
      router.switchWorkspace('image');
      if (picture && 'recordId' in picture) {
        const d = drawing.snapshot(), record = [...d.history, ...d.favorites].find(r => r.id === picture.recordId);
        if (record) drawing.show(record, true);
      }
    } else if (line.workspace === 'edit') {
      if (!editor.board(line.sourceId)) throw new Error('编辑画板已关闭');
      if (editor.switchBoard(line.sourceId)) router.switchWorkspace('edit');
    } else {
      const c = chat.snapshot().conversations.find(c => c.id === line.sourceId);
      if (!c) throw new Error('对话已删除');
      chat.switchConversation(c); router.switchWorkspace('chat');
      if (picture?.kind === 'chat') {
        chat.mutate(current => {
          const turn = current.turns.find(t => t.id === picture.turnId);
          const index = turn?.versions.findIndex(v => v.id === picture.versionId) ?? -1;
          if (turn && index >= 0) turn.selectedVersion = index;
        }, true);
        await nextTick();
        document.querySelector<HTMLElement>(`[data-turn="${CSS.escape(picture.turnId)}"]`)?.scrollIntoView({ block: 'center' });
      }
    }
  }
  async function resume() {
    const location = home.store.snapshot().preferences.lastLocation?.workspace ?? 'image';
    router.switchWorkspace(location === 'edit' && !editor.boards().some(b => b.versions.length) ? 'image' : location);
  }
  function key(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')
      || router.route.value.overlay || document.querySelector('dialog[open],:popover-open,.ask-island[data-mode="exp"]')) return;
    if (event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (router.route.value.workspace === 'home') void resume().catch(e => ui.toast(message(e), 'err'));
      else router.switchWorkspace('home');
    } else if (event.key === 'Enter' && (!target || target === document.body || target === document.documentElement || target.matches('[data-workspace-root=home]')) && router.route.value.workspace === 'home' && home.snapshot().current) {
      event.preventDefault(); void resume().catch(e => ui.toast(message(e), 'err'));
    }
  }
  window.addEventListener('keydown', key);
  onScopeDispose(() => window.removeEventListener('keydown', key));
  return { enter, resume };
}
export type HomeNavigation = ReturnType<typeof createHomeNavigation>;
export const homeNavigationKey: InjectionKey<HomeNavigation> = Symbol('home-navigation');
export function useHomeNavigation() {
  const value = inject(homeNavigationKey); if (!value) throw new Error('Home navigation unavailable'); return value;
}
