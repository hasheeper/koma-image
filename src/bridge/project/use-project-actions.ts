import { onScopeDispose, shallowRef } from 'vue';
import { useBridge } from '../../app/bridge.ts';
import { useAsk } from '../../app/ask.ts';
import { useDrawing } from '../../app/drawing.ts';
import { useChat } from '../../app/chat.ts';
import { useEditor } from '../../app/editor.ts';
import { useShell } from '../../app/shell.ts';
import { useServices } from '../../app/services.ts';
import { useUi, message } from '../../app/ui.ts';
import { referenceName, readReferences } from '../../domain/nai-references.ts';
import type { ReferenceKind } from '../../domain/nai-references.ts';
import { download } from '../../shared/files.ts';

export function useProjectActions() {
  const bridge=useBridge(), ask=useAsk(), {drawing,view}=useDrawing(), {chat}=useChat(), {editor}=useEditor(), {router}=useShell(), services=useServices(), ui=useUi();
  const busy=shallowRef(false), controller=new AbortController();
  onScopeDispose(()=>controller.abort());
  async function read(path:string) {
    const source=bridge.referenceSnapshot(); if(!source)throw new Error('请先恢复企划目录连接');
    return source.read(path,controller.signal,20*1024*1024);
  }
  async function run(work:()=>Promise<void>) {
    if(busy.value)return;busy.value=true;
    try {await work();}catch(e){if(!controller.signal.aborted)ui.toast(message(e),'err');}finally{busy.value=false;}
  }
  function quote(path:string, title:string) {
    bridge.closeProject(); ask.show({question:`参考企划资料「${title}」：${path}`});
  }
  return {busy,view,read,run,quote,
    attach(path:string){return run(async()=>{await ask.addReference(path);bridge.closeProject();ask.show();});},
    download(path:string){return run(async()=>{const {file}=await read(path);download(file,path.split('/').at(-1)!);});},
    chat(path:string){return run(async()=>{const {file,origin}=await read(path);await chat.start();controller.signal.throwIfAborted();await chat.upload([file],{projectId:origin.projectId!,path:origin.path,version:origin.version});bridge.closeProject();router.switchWorkspace('chat');});},
    edit(path:string){return run(async()=>{const {file,origin}=await read(path);await editor.open('edit',file,file.name.split('/').at(-1),{sourceId:`project:${origin.projectId}:${origin.path}:${origin.version}`,settings:{projectSource:{...origin}}});bridge.closeProject();});},
    reference(path:string,kind:ReferenceKind){return run(async()=>{
      const d=drawing.snapshot(),form=d.form,boardId=d.activeBoardId;
      if (!d.referenceKinds.includes(kind)) throw new Error(`当前 IMAGE 型号或来源不支持 ${referenceName(kind)}`);
      if(form.naiReferences[kind].length>=16)throw new Error('此类参考图已达 16 张');
      const {file}=await read(path), rows=await services.references.upload([file],kind,form.model);
      controller.signal.throwIfAborted();
      const board = drawing.board(boardId);
      if (!board || board.form.model !== form.model || !drawing.snapshot().referenceModelIds.includes(form.model)) throw new Error('来源画板或型号已变化，请重新添加');
      const refs = readReferences(board.form.naiReferences);
      if (refs[kind].length + rows.length > 16) throw new Error('此类参考图已达 16 张');
      refs[kind].push(...rows); refs.active=kind;
      await drawing.editReferences(refs,boardId);ui.toast('已加入 IMAGE 参考图');
    });},
  };
}
