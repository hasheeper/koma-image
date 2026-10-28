import type { Home } from './service.ts';
import type { HomePicture } from './derive.ts';
import type { Ids } from '../ask/ids.ts';
import type { Chat } from '../services/chat.ts';
import { chatImages } from '../ask/chat-context.ts';

/** A metadata-only index. Display caches deliberately never get a readable ID. */
export function homeContext(home: Home, ids: Ids, chat: Chat) {
  const view = home.snapshot(), pictures = chatImages(chat.snapshot());
  function label(p: HomePicture | null) {
    if (!p || p.kind === 'preview') return null;
    if (p.kind === 'favorite') return ids.favorite(p.recordId) ?? null;
    if (p.kind === 'history') return ids.label(p.recordId) ?? null;
    if (p.kind !== 'chat' || p.conversationId !== chat.snapshot().current.id) return null;
    return pictures.find(image => image.turn.id === p.turnId && image.version.id === p.versionId && image.assetId === p.assetId)?.label ?? null;
  }
  return {
    lines: view.allLines.map(l => ({ id: l.id, type: l.workspace, title: l.title, face: label(l.face), status: l.status })),
    finals: { count: view.finals.length, recent: view.finals.slice(0, 12).map(f => ({ id: ids.favorite(f.recordId), source: f.source })) },
  };
}
