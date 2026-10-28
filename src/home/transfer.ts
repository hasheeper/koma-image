import type { HomePicture } from './derive.ts';
import type { Home } from './service.ts';
import type { Drawing } from '../services/drawing.ts';
import type { Chat } from '../services/chat.ts';

export const homePictureType = 'application/x-koma-home-picture';
export function dragHomePicture(event: DragEvent, picture: HomePicture | null) {
  if (!picture || picture.kind === 'preview' || !event.dataTransfer) { event.preventDefault(); return; }
  event.dataTransfer.setData(homePictureType, JSON.stringify(picture));
  event.dataTransfer.effectAllowed = 'copy';
}
/** Resolve an owned original by stable identity; never accept URLs from a drop. */
export function homePictureFile(data: DataTransfer, drawing: Drawing, chat: Chat, home?: Home): File | null {
  try {
    const p = JSON.parse(data.getData(homePictureType));
    if (!p || typeof p !== 'object') return null;
    let blob: Blob | undefined;
    if (p.kind === 'history' || p.kind === 'favorite') {
      const d = drawing.snapshot();
      blob = (p.kind === 'favorite' ? d.favorites : d.history).find(r => r.id === p.recordId)?.blob;
    } else if (p.kind === 'edit') {
      blob = home?.editVersion(p.boardId, p.versionId)?.blob;
    } else if (p.kind === 'chat') {
      const c = chat.snapshot().conversations.find(c => c.id === p.conversationId);
      const v = c?.turns.find(t => t.id === p.turnId)?.versions.find(v => v.id === p.versionId);
      if (v?.blocks.some(b => b.type === 'image' && b.assetId === p.assetId)) blob = chat.assets.assets.get(p.assetId)?.blob;
    }
    return blob ? new File([blob], `Koma.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type }) : null;
  } catch { return null; }
}
