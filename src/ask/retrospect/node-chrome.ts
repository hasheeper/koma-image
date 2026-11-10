/** Reserved world space and screen-sized chrome share these camera rules. */
export const NODE_META_ROOM = 64;
export const NODE_STACK_ROOM = 16;
export const NODE_FOOTER_ROOM = 80;
export function nodeChrome(scale: number) {
  const screen = Math.min(1, Math.max(.7, Math.sqrt(scale / .65)));
  const compensation = screen / scale;
  const level = scale >= .34 ? 'full' : scale >= .21 ? 'compact' : 'overview';
  const statusHeight = level === 'full' ? 26 : level === 'compact' ? 16 : 0;
  const statusGap = level === 'full' ? 4 : level === 'compact' ? 3 : 0;
  return { compensation, level, height: level === 'full' ? 26 * compensation : level === 'compact' ? 18 * compensation : 0,
    statusHeight, statusGap, footerHeight: (statusHeight + statusGap) * compensation };
}
