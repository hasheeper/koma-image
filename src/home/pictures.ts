import type { HomePicture } from './derive.ts';
import type { Home } from './service.ts';
import type { Drawing } from '../services/drawing.ts';
import type { Chat } from '../services/chat.ts';
/** URL ownership stays with the existing stores, including display-only previews. */
export function pictureUrl(picture: HomePicture, deps: { home: Home; drawing: Drawing; chat: Chat }) {
  if (picture.kind === 'edit') return deps.home.editVersion(picture.boardId, picture.versionId)?.url ?? '';
  if (picture.kind === 'preview') return deps.home.store.previewUrl(picture.boardId) ?? '';
  if (picture.kind === 'chat') return deps.chat.assets.assets.get(picture.assetId)?.url ?? '';
  const d = deps.drawing.snapshot(), record = [...d.history, ...d.favorites].find(r => r.id === picture.recordId);
  return record ? deps.drawing.url(record) : '';
}
export function activityTime(time: number) {
  if (!time) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
