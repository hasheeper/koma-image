<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { useBridge } from '../../app/bridge.ts';
import { message } from '../../app/ui.ts';
import { makeThumb } from '../../services/image-response.ts';
import AppIcon from '../../shared/AppIcon.vue';
const props=defineProps<{path:string|null; full?:boolean; ambient?:'portrait'|'reference'; alt?:string}>(), bridge=useBridge(), host=shallowRef<HTMLElement>(), url=shallowRef(''), error=shallowRef(''), ratio=shallowRef(1);
const emit=defineEmits<{ratio:[value:number]; size:[value:{width:number;height:number}|null]}>();
let observer:IntersectionObserver|undefined, controller:AbortController|undefined, visible=false;
function clear(){controller?.abort();if(url.value)URL.revokeObjectURL(url.value);url.value='';error.value='';emit('size',null);}
async function load(){
  clear();if(!props.path||!visible)return;
  const own=controller=new AbortController(), source=bridge.referenceSnapshot();
  try {if(!source)throw new Error('目录已断开');const {file}=await source.read(props.path,own.signal,20*1024*1024);const blob=props.full?file:await makeThumb(file);own.signal.throwIfAborted();if(!blob)throw new Error('图片无法解码');url.value=URL.createObjectURL(blob);}
  catch(e){if(!own.signal.aborted)error.value=message(e);}
}
function loaded(event: Event){const image=event.target as HTMLImageElement;if(image.naturalHeight){ratio.value=image.naturalWidth/image.naturalHeight;emit('ratio',ratio.value);emit('size',{width:image.naturalWidth,height:image.naturalHeight});}}
function broken(){const previous=url.value;url.value='';if(previous)URL.revokeObjectURL(previous);error.value='图片无法解码';}
watch([()=>props.path,()=>props.full,()=>bridge.refFiles.value.find(f=>f.path===props.path)?.modified,()=>bridge.refFiles.value.find(f=>f.path===props.path)?.bytes,()=>bridge.projectEpoch.value],()=>void load());
onMounted(()=>{observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){visible=true;observer?.disconnect();void load();}});if(host.value)observer.observe(host.value);});
onBeforeUnmount(()=>{observer?.disconnect();clear();});
</script>
<template>
  <span ref="host" class="project-image" :class="{full,artwork:ambient}" :data-kind="ambient" :title="error">
    <template v-if="url">
      <span v-if="ambient" class="image-ambient" aria-hidden="true"><img :src="url" alt=""/></span>
      <span class="image-fit"><img :src="url" :alt="alt || ''" :style="{'--art-ratio':ratio}" @load="loaded" @error="broken"/></span>
    </template>
    <span v-else class="project-image-placeholder"><AppIcon :name="error ? 'i-warning' : 'i-image'"/><small v-if="error && full">{{ error }}</small></span>
  </span>
</template>
<style scoped>
.project-image { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--well); border-radius: var(--r2); }
.image-fit { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.image-fit > img { width: 100%; height: 100%; object-fit: contain; }
.project-image.full { background: none; }
.full .image-fit { container-type: size; }
.full:not(.artwork) .image-fit > img { width: min(100cqw, calc(100cqh * var(--art-ratio, 1))); height: min(100cqh, calc(100cqw / var(--art-ratio, 1))); background: var(--image-checker); border-radius: var(--r2); box-shadow: var(--print-shadow); }
.project-image.artwork { isolation: isolate; background: var(--chrome); }
.artwork .image-fit { position: relative; padding: var(--project-image-inset, 16px); container-type: size; }
.artwork .image-fit > img { width: min(100cqw, calc(100cqh * var(--art-ratio, 1))); height: min(100cqh, calc(100cqw / var(--art-ratio, 1))); max-width: none; object-fit: contain; }
.artwork[data-kind=reference] .image-fit > img { mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent), linear-gradient(to bottom, transparent, #000 12px, #000 calc(100% - 12px), transparent); mask-composite: intersect; }
.image-ambient { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; mask-image: linear-gradient(to left, #000 30%, transparent 78%), linear-gradient(to bottom, #000 35%, transparent 85%); mask-composite: intersect; }
.image-ambient img { position: absolute; top: -4%; left: 34%; width: auto; max-width: none; height: 210%; filter: brightness(.5) contrast(.72) saturate(.8) blur(1px); opacity: .22; }
.artwork[data-kind=reference] .image-ambient { mask-image: none; }
.artwork[data-kind=reference] .image-ambient img { top: -8%; left: -8%; width: 116%; height: 116%; object-fit: cover; filter: brightness(.45) saturate(.8) blur(12px); opacity: .24; }
:global(html[data-theme=light]) .image-ambient { opacity: .35; }
.project-image-placeholder { display: grid; justify-items: center; gap: 8px; color: var(--fg-3); }
.project-image-placeholder small { max-width: 32ch; font-size: var(--fz-xs); overflow-wrap: anywhere; }
</style>
