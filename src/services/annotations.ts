import { nextTick, shallowRef } from 'vue';
import { imageEntity } from '../domain/image-identity.ts';
import type { ImageTagBinding } from '../domain/image-identity.ts';
import { defaultAnnotationEdges, validateAnnotationSnapshot, annotationPrompt } from '../domain/region-annotation.ts';
import type { AnnotationShape, AnnotationSnapshot, RegionAnnotation } from '../domain/region-annotation.ts';
import { annotationPreview } from '../native/annotation-canvas.ts';
import type { Ask } from '../ask/service.ts';
import type { Editor } from './editor.ts';
import type { Chat } from './chat.ts';
import type { AppRouter } from '../app/router.ts';
import type { Fields } from '../storage/records.ts';

export interface AnnotationTarget {
  blob: Blob; name: string; recordId: string; tag?: string; binding?: ImageTagBinding;
  workspace: 'image' | 'chat' | 'edit';
  initialTool?: AnnotationShape;
  settings?: Fields;
  inline?: boolean;
  edit?: { boardId: string; versionId: number };
  chat?: { conversationId: string; turnId?: string; versionId?: string; assetId?: string };
}
export interface AnnotationReview {
  source: Blob; raw: Blob; snapshot: AnnotationSnapshot; title: string;
  apply: (blob: Blob) => Promise<void>;
}
export function createAnnotations(deps: {ask: Ask; editor: Editor; chat: Chat; router: AppRouter}) {
  const active=shallowRef<{target: AnnotationTarget; snapshot: AnnotationSnapshot}|null>(null);
  const review=shallowRef<AnnotationReview|null>(null), busy=shallowRef(false);
  const drafts=new Map<string,AnnotationSnapshot>(), page=crypto.randomUUID();let revision=0;
  const key=(s:AnnotationSnapshot)=>`${s.image.scope.id}:${s.image.record_id}:${s.image.entity_key}`;
  deps.editor.setAnnotationReader((boardId, versionId) => {
    const owner = deps.editor.boards().find(b=>b.id===boardId);
    const version = owner?.versions.find(v => v.id === versionId);
    if (!version) return;
    const candidates = [...drafts.values(), ...(active.value ? [active.value.snapshot] : [])];
    const snapshot = candidates.reverse().find(s => s.image.record_id === version.recordId && s.image.entity_key === version.entity_key);
    return snapshot ? structuredClone(snapshot) : undefined;
  });
  function changed() { const edit = active.value?.target.edit; if (edit) deps.editor.annotationsChanged(edit.boardId, edit.versionId); }
  function remember(snapshot:AnnotationSnapshot){drafts.set(key(snapshot),structuredClone(snapshot));if(drafts.size>64)drafts.delete(drafts.keys().next().value!);}
  function close(){revision++;active.value=null;}
  return {
    active,review,busy,
    async open(target:AnnotationTarget) {
      if(busy.value)throw new Error('请等待批注处理完成');
      close();const rev=revision;
      // A board opened from CHAT keeps that conversation, however annotation is re-entered.
      if (target.workspace === 'edit' && !target.chat && target.edit?.boardId === deps.editor.session.id) {
        const chat = deps.editor.chatSource(target.edit.versionId);
        if (chat) target = { ...target, chat };
      }
      if (target.workspace !== 'edit') {
        const opened = await deps.editor.open(target.workspace, target.blob, target.name, {
          sourceId: target.workspace === 'image' ? `record:${target.recordId}` : target.recordId,
          conversationId: target.chat?.conversationId,
          settings: target.settings,
          viewSource: true,
        });
        if (!opened || rev !== revision) return;
        const view = deps.editor.snapshot(), version = view.viewed;
        if (!version || view.session.id !== opened.boardId || version.id !== opened.versionId || view.busy || view.preparing || view.reading || view.externalId) return;
        target = { ...target, blob: version.blob, name: version.name, recordId: version.recordId, tag: deps.editor.reference(version), binding: undefined, workspace: 'edit', inline: true, edit: opened };
        await nextTick();
      }
      const current = () => rev === revision && deps.router.route.value.workspace === 'edit' && target.edit?.boardId === deps.editor.session.id && target.edit?.versionId === deps.editor.snapshot().viewed?.id;
      if (!current()) return;
      const bitmap=await createImageBitmap(target.blob);
      try {
        if(bitmap.width*bitmap.height>32_000_000)throw new Error('批注最多支持 3200 万像素');
        const entity=await imageEntity(target.blob), binding=target.binding??deps.ask.pictureBinding(target.recordId,target.tag);
        if(binding?.entity_key && binding.entity_key!==entity)throw new Error('批注图片身份已变化');
        const image=binding?{...binding,entity_key:entity}:{tag:target.tag??'',entity_key:entity,record_id:target.recordId,scope:target.chat?{kind:'chat' as const,id:target.chat.conversationId,turn_id:target.chat.turnId,version_id:target.chat.versionId,asset_id:target.chat.assetId}:{kind:'page' as const,id:page,...(target.edit?{board_id:target.edit.boardId}: {})}};
        const initial:AnnotationSnapshot={image,width:bitmap.width,height:bitmap.height,regions:[],edges:{...defaultAnnotationEdges}};
        const snapshot=structuredClone(drafts.get(key(initial))??initial);
        if(!current())return;
        active.value={target:{...target,inline:true},snapshot};
      }finally{bitmap.close();}
    },
    update(regions: RegionAnnotation[]) {const a=active.value;if(!a||busy.value)return;const snapshot={...a.snapshot,regions};active.value={...a,snapshot};remember(snapshot);changed();},
    edges(dilate:number,feather:number){const a=active.value;if(!a||busy.value)return;const snapshot={...a.snapshot,edges:{dilate,feather}};if(snapshot.regions.length)validateAnnotationSnapshot(snapshot);active.value={...a,snapshot};remember(snapshot);},
    close,
    /** CHAT goes to the image's own conversation unless a new one is asked for. */
    async act(action:'ask'|'chat', fresh=false) {
      const a=active.value;if(!a||busy.value)return;
      const snapshot=structuredClone(a.snapshot);validateAnnotationSnapshot(snapshot);busy.value=true;
      try{
        if(action==='ask'){const preview=await annotationPreview(a.target.blob,snapshot);await deps.ask.prepareAnnotations(a.target.blob,preview,snapshot);}
        else if(action==='chat'){const preview=await annotationPreview(a.target.blob,snapshot);await deps.chat.prepareAnnotations(a.target.blob,preview,snapshot,fresh?undefined:a.target.chat);deps.router.switchWorkspace('chat');}
        close();
      }finally{busy.value=false;}
    },
    openReview(value:AnnotationReview){review.value=value;},
    chatReview(conversationId:string,turnId:string,versionId:string,assetId:string){review.value=deps.chat.annotationReview(conversationId,turnId,versionId,assetId);},
    editorReview(boardId:string,versionId:number){review.value=deps.editor.annotationReview(boardId,versionId);},
    prompt:annotationPrompt,
    dispose(){close();drafts.clear();review.value=null;deps.editor.setAnnotationReader(undefined);},
  };
}
export type Annotations=ReturnType<typeof createAnnotations>;
