import type { Ref } from 'vue';
import type { HistoryRecord } from '../../domain/drawing.ts';
import { imageFileName } from '../../domain/drawing.ts';
import { useAnnotations } from '../../app/annotations.ts';
import { useEditor } from '../../app/editor.ts';
import { useServices } from '../../app/services.ts';
import { useShell } from '../../app/shell.ts';
import { useUi, message } from '../../app/ui.ts';
import { createHandoff } from '../../services/handoff.ts';

/** Stage and evolution inspection use the same original-image handoff paths. */
export function useImageActions(current: Readonly<Ref<HistoryRecord | null>>) {
  const annotations = useAnnotations(), { editor } = useEditor(), services = useServices();
  const { router, image } = useShell(), ui = useUi();
  async function annotate() {
    const item = current.value; if (!item?.blob) return;
    image.zoom = false;
    try { await annotations.open({ blob: item.blob, name: imageFileName(item), recordId: item.id, settings: item.params, workspace: 'image' }); }
    catch (error) { ui.toast(message(error), 'err'); }
  }
  async function resultAction(id: string) {
    const item = current.value; if (!item?.blob) return;
    try {
      if (id === 'annotateBtn') await annotate();
      else if (id === 'chatBtn') {
        const ticket = await createHandoff(services).queue(item.blob, imageFileName(item), { recordId: item.id, entityKey: item.entity_key });
        const url = new URL(location.href); url.searchParams.set('image', ticket); history.replaceState(history.state, '', url);
        router.switchWorkspace('chat'); ui.imageDelivery.value++;
      } else await editor.open('image', item.blob, imageFileName(item), { mode: 'img2img', settings: item.params, sourceId: `history:${item.id}` });
    } catch (error) { ui.toast(message(error), 'err'); }
  }
  return { annotate, resultAction };
}
