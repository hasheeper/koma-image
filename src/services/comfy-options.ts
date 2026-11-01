import type { createConnections } from "./connections.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import type { ComfyNodeInfo } from "../domain/comfy-controls.ts";
import { readComfyNodeInfo } from "../gateway/comfyui.ts";

type OptionsState = { loading: boolean; error: string; info: ComfyNodeInfo };
const empty = (): OptionsState => ({loading:false,error:"",info:{}});
/** Page-only schema cache, isolated by connection credentials and configuration. */
export function createComfyOptions(connections: ReturnType<typeof createConnections>, changed: () => void, fetcher: typeof fetch = fetch) {
  const entries = new Map<string,{ key:string; state:OptionsState; abort:AbortController }>();
  let disposed = false;
  function keyFor(model: CatalogModel) { return JSON.stringify([connections.catalogKey(model.connection), model.comfyControls?.signature]); }
  function snapshot(model?: CatalogModel | null): OptionsState {
    if (!model?.comfyControls) return empty();
    try { const entry=entries.get(model.connection); return entry?.key===keyFor(model) ? entry.state : empty(); } catch { return empty(); }
  }
  async function load(model?: CatalogModel | null, force=false) {
    if (!model?.comfyControls || disposed) return;
    const id=model.connection;
    try {
      const context=connections.context(id), key=keyFor(model), old=entries.get(id);
      if (!key) return;
      if (old?.key===key && (!force || old.state.loading)) return;
      old?.abort.abort();
      const entry={key,state:{loading:true,error:"",info:{}} as OptionsState,abort:new AbortController()};
      entries.set(id,entry);changed();
      const spec=model.comfyControls;
      const classes=[...Object.values(spec.fields),...spec.loras.flatMap(s=>[s.name,s.model,...(s.clip?[s.clip]:[])])].map(f=>f.classType);
      try {
        const info=await readComfyNodeInfo(context,classes,entry.abort.signal,fetcher);
        if (!disposed && entries.get(id)===entry && keyFor(model)===key) entry.state={loading:false,error:"",info};
      } catch (error) {
        if (!disposed && entries.get(id)===entry && !entry.abort.signal.aborted) entry.state={loading:false,error:error instanceof TypeError ? "无法读取节点选项，请检查连接并刷新；当前值已保留" : error instanceof Error ? error.message : "读取节点选项失败",info:{}};
      } finally { if (!disposed) changed(); }
    } catch { /* Missing credentials are reported by the connection and catalog UI. */ }
  }
  return { snapshot,load,dispose(){disposed=true;for(const entry of entries.values())entry.abort.abort();entries.clear();} };
}
