<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useId, useTemplateRef, watch } from 'vue';
import { useAsk } from '../../app/ask.ts';
import { message } from '../../app/ui.ts';
import AppIcon from '../../shared/AppIcon.vue';
import EvolutionAction from './EvolutionAction.vue';
import { recipeWorkspace } from './recipe.ts';
import { workshopPending } from './workshops.ts';
import StageImage from './StageImage.vue';
import VersionGraph from './VersionGraph.vue';
import RecipeInspector from './RecipeInspector.vue';
import PaneIdentity from './PaneIdentity.vue';
import StageTools from './StageTools.vue';
import StageDock from './StageDock.vue';
import GraphTools from './GraphTools.vue';
import RetrospectActions from './RetrospectActions.vue';
import RetrospectNote from './RetrospectNote.vue';
import type { PictureRefs } from '../edit-context.ts';
import type { Retrospect, RetrospectNode } from './model.ts';
import { finalPath } from './store.ts';
import { isStaged, selectRetrospectSample, selectRetrospectBaseline } from './model.ts';
import type { ReviewPicture, ImageView, GraphObject, NoteTarget } from './view.ts';
import { nodeNoteKey, edgeNoteKey } from './annotations.ts';

const props = defineProps<{ value: Retrospect; pictureRefs: PictureRefs; recordId: string; initialVersion?: string }>();
const emit = defineEmits(['close']);
const ask = useAsk(), titleId = useId(), dialog = useTemplateRef<HTMLDialogElement>('dialog');
const askMount = useTemplateRef<HTMLElement>('askMount'), graphView = useTemplateRef<InstanceType<typeof VersionGraph>>('graphView');
const graphDock = useTemplateRef<InstanceType<typeof StageDock>>('graphDock'), imageDock = useTemplateRef<InstanceType<typeof StageDock>>('imageDock');
const detailId = useId(), detailOpened = shallowRef(!matchMedia('(max-width: 860px)').matches);
const detailMode = shallowRef<'floating' | 'sidebar'>('floating');
const registry = ask.retrospects, askHost = registry.host;
const noteTarget = shallowRef<NoteTarget | null>(null), graphSelection = shallowRef<readonly GraphObject[]>([]);
const record = computed(() => registry.get(props.recordId, ask.evolutionTarget.value));
const notes = computed(() => record.value?.notes ?? {});
const newNodes = computed(() => new Set(record.value?.newNodes));
const finalNodes = computed(() => record.value ? finalPath(record.value) : new Set<string>());
const nextNode = computed(() => registry.pending(props.recordId, ask.evolutionTarget.value));
const ended = computed(() => record.value?.status === 'ended');
function resume() {
  if (!ask.setEvolutionStatus(props.recordId, 'active')) return;
  if (!askOpened.value) followup();
}
watch(ended, () => { noteTarget.value = null; });
watch(() => [props.value, props.pictureRefs] as const, (_, previous) => {
  if (!props.value.nodes.some(n => n.id === selected.value)) selected.value = record.value?.cursor?.nodeId ?? props.value.nodes.at(-1)!.id;
  if (manualBaseline.value && !props.value.nodes.some(n => n.id === manualBaseline.value)) manualBaseline.value = null;
  chosenSamples.value = Object.fromEntries(Object.entries(chosenSamples.value).flatMap(([id, sample]) => {
    const recordId = previous[1][sample]?.record_id;
    const replacement = props.value.nodes.find(n => n.id === id)?.image_ids.find(tag => recordId
      ? props.pictureRefs[tag]?.record_id === recordId : tag === sample);
    return replacement ? [[id, replacement]] : [];
  }));
  noteTarget.value = null;
});
const askOpened = computed(() => !!ask.visible?.value);
let previousHost: HTMLElement | null = null, closing = false;
const returnFocus = document.activeElement;
const openingBase = record.value?.final ?? record.value?.cursor;
const selected = shallowRef(props.value.nodes.some(node => node.id === props.initialVersion) ? props.initialVersion! : openingBase?.nodeId ?? props.value.nodes.at(-1)!.id);
const manualBaseline = shallowRef<string | null>(null);
const parentOf = (id: string) => props.value.edges.find(e => e.to === id)?.from ?? '';
const baseline = computed(() => manualBaseline.value ?? parentOf(selected.value));
const view = shallowRef<ImageView>('B'), activePane = shallowRef<'A' | 'B'>('B');
const scene = shallowRef<'graph' | 'image'>('graph');
function collapseDetails() {
  detailOpened.value = false;
  void nextTick(() => (scene.value === 'graph' ? graphDock.value : imageDock.value)?.focusRecipe());
}
function toggleDetails() {
  if (detailOpened.value) { collapseDetails(); return; }
  if (matchMedia('(max-width: 860px)').matches && askOpened.value) ask.hide();
  detailOpened.value = true;
}
watch(askOpened, open => { if (open && matchMedia('(max-width: 860px)').matches) detailOpened.value = false; });
const feedback = shallowRef(''), failed = shallowRef(false), restoring = shallowRef(false), chosenSamples = shallowRef<Record<string, string>>(openingBase?.nodeId === selected.value ? { [openingBase.nodeId]: openingBase.imageId } : {}), zoomLevels = shallowRef<Record<string, number>>({});
const workshopViews = computed(() => (record.value?.workshops ?? []).filter(workshopPending).flatMap(t => {
  const parent = props.value.nodes.find(n => n.image_ids.some(tag => props.pictureRefs[tag]?.record_id === t.anchorRecordId));
  return parent ? [{ id: t.id, target: t.target, name: t.name, parentId: parent.id, available: ask.workshopAvailable(t.target), ended: record.value?.status === 'ended' }] : [];
}));
async function workshopAction(id: string, cancel = false) {
  try { if (cancel) await ask.cancelWorkshop(props.recordId, id); else await ask.openWorkshop(props.recordId, id); }
  catch (error) { feedback.value = error instanceof Error ? error.message : String(error); failed.value = true; }
}
const selectedSample = (node: RetrospectNode) => selectRetrospectSample(node, chosenSamples.value[node.id] ?? node.cover);
const b = computed(() => selectedSample(props.value.nodes.find(n => n.id === selected.value)!));
const pending = computed(() => isStaged(b.value));
const generatingNodes = computed(() => registry.generatingNodes(props.recordId));
const generatingSelected = computed(() => generatingNodes.value.has(b.value.id));
const loaded = computed(() => pending.value && !ended.value && record.value?.cursor?.nodeId === b.value.id);
const runtimeHint = computed(() => {
  if (!isStaged(b.value)) return '';
  const { overrides, form } = b.value.staged;
  return [overrides.includes('seed') ? `Seed ${form.seed || '随机'}` : '沿用当前 Seed', overrides.includes('batchCount') ? `生成 ${form.batchCount} 张` : '沿用当前张数'].join(' · ');
});
const loadHistory = computed(() => ask.evolutionHistory(props.recordId));
const a = computed(() => selectRetrospectBaseline(props.value, b.value, baseline.value, manualBaseline.value === null && isStaged(b.value) ? undefined : chosenSamples.value[baseline.value]));
watch([a, b], ([left, right]) => { if (isStaged(right) || left && isStaged(left)) scene.value = 'graph'; });
const displayedSample = (node: RetrospectNode) => node.id === a.value?.id ? a.value : node.id === b.value.id ? b.value : selectedSample(node);
const panes = computed<{ node: RetrospectNode; mark: 'A' | 'B' }[]>(() => view.value === 'pair' && a.value ? [{ node: a.value, mark: 'A' }, { node: b.value, mark: 'B' }] : [{ node: view.value === 'A' && a.value ? a.value : b.value, mark: view.value === 'A' && a.value ? 'A' : 'B' }]);
const images = new Map<string, InstanceType<typeof StageImage>>();
function picture(id: string): ReviewPicture {
  void ask.libraryRevision.value;
  return { id, ...ask.pictureInfo(id, props.pictureRefs) };
}
const sampleOf = (node: RetrospectNode) => picture(displayedSample(node).cover);
const pictures = computed(() => Object.fromEntries(props.value.nodes.map(node => [node.id, sampleOf(node)])));
const cursorPicture = computed(() => record.value?.cursor ? picture(nextNode.value?.imageId ?? record.value.cursor.imageId) : undefined);
const backPictures = computed(() => Object.fromEntries(props.value.nodes.map(node => {
  if (node.image_ids.length < 2) return [node.id, []];
  const index = node.image_ids.indexOf(sampleOf(node).id);
  const ids = [1, 2].slice(0, node.image_ids.length - 1).map(offset => node.image_ids[(index + offset) % node.image_ids.length]);
  return [node.id, ids.map(picture)];
})));
const activeMark = computed(() => panes.value.length > 1 ? activePane.value : panes.value[0].mark);
const toolPane = computed(() => panes.value.find(pane => pane.mark === activeMark.value) ?? panes.value[0]);
const zoomLabel = computed(() => `${zoomLevels.value[activeMark.value] ?? 100}%`);
function setImage(mark: string, instance: unknown) { if (instance) images.set(mark, instance as InstanceType<typeof StageImage>); else images.delete(mark); }
function updateZoom(mark: string, value: number) { zoomLevels.value = { ...zoomLevels.value, [mark]: value }; }
function imageAction(action: 'fit' | 'step' | 'actualSize', delta = 0) { const image = images.get(activeMark.value); if (action === 'step') image?.step(delta); else image?.[action](); }
function choose(node: RetrospectNode, shift: boolean) {
  if (shift) { if (node.id !== selected.value) setBaseline(node.id); return; }
  // The automatic A sample can differ from the stage cover; selecting it keeps the visible image.
  chosenSamples.value = { ...chosenSamples.value, [node.id]: displayedSample(node).cover };
  selected.value = node.id;
  if (manualBaseline.value === node.id) manualBaseline.value = null;
  view.value = 'B'; activePane.value = 'B'; feedback.value = '';
  if (isStaged(node)) { scene.value = 'graph'; detailOpened.value = true; }
}
function openImage(node: RetrospectNode) { choose(node, false); if (!isStaged(node)) scene.value = 'image'; }
function setBaseline(id: string | null) { manualBaseline.value = id; if (!a.value && view.value !== 'B') view.value = 'B'; feedback.value = ''; }
function swap() {
  if (!a.value) return;
  chosenSamples.value = { ...chosenSamples.value, [a.value.id]: a.value.cover, [b.value.id]: b.value.cover };
  const previous = selected.value; selected.value = a.value.id; manualBaseline.value = previous;
  view.value = 'B'; activePane.value = 'B'; feedback.value = '';
  if (isStaged(b.value)) scene.value = 'graph';
}
function selectSample(node: RetrospectNode, id: string) {
  if (node.image_ids.includes(id)) { chosenSamples.value = { ...chosenSamples.value, [node.id]: id }; feedback.value = ''; }
}
async function close() {
  if (closing) return;
  closing = true; noteTarget.value = null;
  if (askHost.value === askMount.value) askHost.value = previousHost?.isConnected ? previousHost : null;
  await nextTick(); dialog.value?.close(); emit('close');
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
}
function actionNode(node = b.value) {
  return displayedSample(node);
}
async function restore(node: RetrospectNode = b.value) {
  if (restoring.value) return;
  const target = actionNode(node); restoring.value = true; failed.value = false; feedback.value = '';
  try {
    if (isStaged(target)) { await ask.loadEvolutionBranch(props.recordId, target.id); if (!detailOpened.value) feedback.value = `已载入 ${target.label} · 返回画板后手动生成`; }
    else { await ask.restoreRetrospect(target, props.pictureRefs, props.recordId); feedback.value = recipeWorkspace(target.recipe) === 'image' ? '已恢复 IMAGE 配方' : '已定位原版本'; }
  }
  catch (error) { failed.value = true; feedback.value = message(error); }
  finally { restoring.value = false; }
}
async function continueOnBoard() {
  try { ask.editEvolution(props.recordId); await close(); }
  catch (error) { failed.value = true; feedback.value = message(error); }
}
async function finalize() {
  if (restoring.value) return;
  restoring.value = true; failed.value = false; feedback.value = '';
  try { await ask.finalizeEvolution(props.recordId, actionNode()); feedback.value = '已设为定稿并收藏'; }
  catch (error) { failed.value = true; feedback.value = message(error); }
  finally { restoring.value = false; }
}
async function removePending() {
  try { ask.removeEvolutionBranch(props.recordId, b.value.id); feedback.value = '已删除未生成预设'; failed.value = false; }
  catch (error) { failed.value = true; feedback.value = message(error); }
}
const unavailable = computed(() => {
  if (isStaged(b.value)) return ended.value || !ask.pictureInfo(b.value.staged.base.tag, props.pictureRefs);
  void ask.libraryRevision.value;
  const p = ask.pictureInfo(b.value.cover, props.pictureRefs);
  return !p || p.parametersUnavailable;
});
const thumbnailOnly = computed(() => { void ask.libraryRevision.value; return !!ask.pictureInfo(b.value.cover, props.pictureRefs)?.thumbnailOnly; });
watch(unavailable, missing => { if (missing) feedback.value = ''; });
function followup() {
  if (askOpened.value) { ask.hide(); return; }
  try {
    const keys = graphSelection.value.length ? graphSelection.value.map(o => o.key) : [
      ...(a.value ? [nodeNoteKey(a.value.id)] : []), nodeNoteKey(b.value.id),
      ...props.value.edges.filter(e => e.from === a.value?.id && e.to === b.value.id).map(edgeNoteKey),
    ];
    ask.openRetrospectAsk(props.recordId, actionNode(), a.value ? actionNode(a.value) : null, keys);
    noteTarget.value = null;
  } catch (error) { failed.value = true; feedback.value = message(error); }
}
function annotate(target: NoteTarget) { if (!ended.value) noteTarget.value = target; }
const noteValues = computed(() => noteTarget.value?.items.map(item => notes.value[item.key] ?? '') ?? []);
const mixedNotes = computed(() => new Set(noteValues.value).size > 1);
const noteValue = computed(() => mixedNotes.value ? '' : noteValues.value[0] ?? '');
function writeNote(text: string | null) {
  if (!noteTarget.value) return;
  try {
    registry.annotate(props.recordId, noteTarget.value.items.map(i => i.key), text);
    noteTarget.value.viewport.focus({ preventScroll: true }); noteTarget.value = null;
  } catch (error) { failed.value = true; feedback.value = message(error); }
}
function closeNote(key: string) { if (noteTarget.value?.key === key) noteTarget.value = null; }
function removeNote() { writeNote(null); }
function cancel() {
  if (noteTarget.value) noteTarget.value = null;
  else if (askOpened.value) ask.hide();
  else if (detailOpened.value) collapseDetails();
  else if (scene.value !== 'graph' || !graphView.value?.escape()) void close();
}
function keys(event: KeyboardEvent) {
  if ((event.target as Element).closest('#askIsland') || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') return;
  event.stopPropagation();
}
watch(scene, () => { noteTarget.value = null; });
onMounted(() => {
  dialog.value?.showModal(); previousHost = askHost.value;
  ask.hide?.(); askHost.value = askMount.value;
});
onBeforeUnmount(() => {
  if (askHost.value === askMount.value) askHost.value = previousHost?.isConnected ? previousHost : null;
  images.clear(); dialog.value?.close();
});
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="modal stage-panel" :data-detail-open="detailOpened || undefined" :data-detail-mode="detailMode" :aria-labelledby="titleId" @cancel.prevent="cancel" @keydown="keys">
      <h2 :id="titleId" class="sr-only">{{ value.title }}</h2>
      <button class="ibtn stage-close" type="button" aria-label="关闭演进" data-tip="关闭演进" @click="close"><AppIcon name="i-close" /></button>
      <main class="stage-main">
        <VersionGraph :workshops="workshopViews" @open-workshop="workshopAction($event)" @cancel-workshop="workshopAction($event, true)" ref="graphView" v-show="scene === 'graph'" :active="scene === 'graph'" :cursor="record?.status === 'active' ? record.cursor ?? undefined : undefined" :pending="nextNode" :cursor-picture="cursorPicture" :restore-disabled="restoring || !ask.canManage.value" :final-node="record?.final?.nodeId" :final-path="finalNodes" :graph="value" :generating-nodes="generatingNodes" :node-layout="record?.nodeLayout" :continuation-anchor="record?.continuationAnchor" :graph-camera="record?.graphCamera" :new-nodes="newNodes" :selected="selected" :baseline="baseline" :pictures="pictures" :back-pictures="backPictures" :notes="notes" :readonly="ended" @select="choose" @open="openImage" @sample="selectSample" @restore="restore" @continue="continueOnBoard" @arrange="registry.arrange(recordId, $event)" @arrange-continuation="registry.arrangeContinuation(recordId, $event, record?.boardId ?? undefined)" @remember-camera="registry.rememberCamera(recordId, $event)" @annotate="annotate" @selection="graphSelection = $event" @camera="noteTarget = null">
          <template #toolbar="graph">
            <StageDock ref="graphDock" scene="graph" :image-disabled="pending || !!a && isStaged(a)" :detail-id="detailId" :detail-opened="detailOpened" :ask-opened="askOpened" :ask-disabled="restoring" @scene="scene = $event" @detail="toggleDetails" @ask="followup">
              <GraphTools :tool="graph.tool" :selection-mode="graph.selectionMode" :percent="graph.percent" :annotation-disabled="ended" @tool="graph.setTool" @mode="graph.setMode" @zoom="graph.zoom" @fit="graph.fit" />
            </StageDock>
          </template>
        </VersionGraph>
        <div v-show="scene === 'image'" class="stage-image-view">
          <div class="stage-panes" :class="{ paired: panes.length > 1 }">
            <figure v-for="pane in panes" :key="pane.mark" class="stage-pane" :class="{ active: activeMark === pane.mark }" :aria-label="`${pane.mark} ${pane.node.id} 图片`" @pointerdown="activePane = pane.mark" @focusin="activePane = pane.mark">
              <PaneIdentity :pane="pane" :picture="sampleOf(pane.node)" :active="activeMark === pane.mark" />
              <StageImage :ref="instance => setImage(pane.mark, instance)" :active="scene === 'image'" :src="sampleOf(pane.node).url" :label="`${pane.node.id} ${sampleOf(pane.node).id} ${pane.node.label}`" @zoom="updateZoom(pane.mark, $event)" />
            </figure>
          </div>
          <StageDock ref="imageDock" scene="image" :detail-id="detailId" :detail-opened="detailOpened" :ask-opened="askOpened" :ask-disabled="restoring" @scene="scene = $event" @detail="toggleDetails" @ask="followup">
            <StageTools :view="view" :has-baseline="!!a" :active-mark="activeMark" :zoom-label="zoomLabel" :samples="toolPane.node.image_ids.map(picture)" :selected-sample="sampleOf(toolPane.node).id" :version="toolPane.node.id" @view="view = $event" @image-action="imageAction" @sample="selectSample(toolPane.node, $event)" />
          </StageDock>
        </div>
      </main>
      <RecipeInspector v-show="detailOpened" :id="detailId" class="stage-detail" :mode="detailMode" :a="a" :b="b" :graph="value" :pictures="pictures" :automatic="manualBaseline === null" @baseline="setBaseline" @swap="swap" @placement="detailMode = detailMode === 'floating' ? 'sidebar' : 'floating'" @close="collapseDetails">
        <template #status><small v-if="ended" class="retrospect-ended">{{ record?.final ? '已定稿' : '已解除' }}</small><RetrospectActions :record-id="recordId" /></template>
        <template #actions>
          <p v-if="feedback" class="stage-feedback" role="status" :class="{ failed }">{{ feedback }}</p><p v-else-if="unavailable && !ended" class="stage-feedback">{{ pending ? '预设基底已失效，可继续查看配方' : '原记录已失效' }}</p>
          <p v-if="pending" class="branch-guidance" role="status">{{ generatingSelected ? '生成中 · 成功后图像会填入此处' : loaded ? '已载入 · 回画板调整后手动生成' : runtimeHint }}</p>
          <div v-else-if="thumbnailOnly" class="thumbnail-notice">仅缩略图 · 完整配方可对照与恢复</div>
          <div class="stage-action-buttons" :class="{ 'branch-action-row': pending }">
            <div v-if="pending || loadHistory.undo || loadHistory.redo" class="stage-secondary-actions">
              <button v-if="pending" class="ibtn branch-delete" type="button" aria-label="删除预设" :title="generatingSelected ? '生成中，暂不可删除' : '删除未生成预设'" :disabled="restoring || generatingSelected || !ask.canManage.value || !record?.boardId" @click="removePending"><AppIcon name="i-trash" /></button>
              <button v-if="loadHistory.undo" class="ibtn" type="button" :aria-label="loadHistory.undoLabel" :title="loadHistory.undoLabel" :disabled="!loadHistory.canUndo || !ask.canManage.value" @click="ask.undoDraft(loadHistory.undo)"><AppIcon name="i-undo" /></button>
              <button v-if="loadHistory.redo" class="ibtn" type="button" :aria-label="loadHistory.redoLabel" :title="loadHistory.redoLabel" :disabled="!loadHistory.canRedo || !ask.canManage.value" @click="ask.restoreDraft(loadHistory.redo)"><AppIcon name="i-redo" /></button>
            </div>
            <template v-if="pending">
              <button v-if="loaded" class="btn btn-sm btn-primary" type="button" @click="continueOnBoard"><AppIcon name="i-back" />前往画板</button>
              <button v-else class="btn btn-sm btn-primary" type="button" :disabled="restoring || unavailable || generatingSelected || !ask.canManage.value" @click="restore()"><AppIcon name="i-pin" />载入画板</button>
            </template>
            <template v-else>
              <EvolutionAction v-if="!ended && recipeWorkspace(b.recipe) === 'image' && pictureRefs[b.cover]" :record-id="pictureRefs[b.cover].record_id" :disabled="restoring" />
              <button class="btn btn-sm btn-quiet" type="button" :disabled="restoring || unavailable || !ask.canManage.value" @click="restore()"><AppIcon name="i-back" />{{ recipeWorkspace(b.recipe) === 'image' ? '恢复到画板' : recipeWorkspace(b.recipe) === 'edit' ? '定位编辑版本' : '定位对话版本' }}</button>
              <button v-if="!ended" class="btn btn-sm btn-quiet" type="button" :disabled="restoring || unavailable || thumbnailOnly || !ask.canManage.value" :title="thumbnailOnly ? '原图已释放，无法设为定稿' : undefined" @click="finalize"><AppIcon name="i-star" />设为定稿</button>
              <button v-if="ended" class="btn btn-sm btn-primary" type="button" @click="resume"><AppIcon name="i-undo" />继续演进</button>
            </template>
          </div>
        </template>
      </RecipeInspector>
      <p v-if="feedback && !detailOpened" class="stage-restore-notice" :class="{ failed }" role="status">{{ feedback }}</p>
      <RetrospectNote v-if="noteTarget" :key="noteTarget.key" :target="noteTarget" :value="noteValue" :mixed="mixedNotes" @save="writeNote" @remove="removeNote" @close="closeNote" />
      <div ref="askMount" class="retrospect-ask-mount"></div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.branch-guidance { margin: 0 0 var(--sp-3); color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.5; }
.stage-secondary-actions { display: flex; align-items: center; flex: none; gap: var(--sp-1); margin-right: auto; }
.stage-secondary-actions > .ibtn { flex: none; width: 32px; height: 32px; border-radius: var(--r2); color: var(--fg-3); --ico: var(--ico-sm); }
.branch-delete:hover:not(:disabled) { color: var(--err); background: var(--hover); }
.branch-action-row > .btn-primary { min-width: 112px; }
.thumbnail-notice { color: var(--fg-3); font-size: var(--fz-xs); }
.stage-panel { --modal-w: 1480px; --detail-width: 392px; --stage-float-reserve: 0px; --stage-dock-space: 112px; position: fixed; width: calc(100vw - 48px); height: min(940px, calc(100dvh - 48px)); max-height: none; background: var(--canvas); }
.stage-panel[data-detail-open] { --stage-float-reserve: calc(var(--detail-width) + var(--sp-4) + var(--sp-3)); }
.stage-panel[data-detail-open][data-detail-mode="sidebar"] { --stage-float-reserve: var(--detail-width); }
.stage-panel[data-detail-open][data-detail-mode="sidebar"] .stage-close { right: calc(var(--detail-width) + var(--sp-4)); }
.retrospect-ask-mount { display: contents; }
.stage-close { position: absolute; top: var(--sp-4); right: var(--sp-4); z-index: 6; width: 32px; height: 32px; border-radius: 999px; color: var(--fg-3); background: var(--glass-bg); box-shadow: 0 0 0 1px var(--line-2); backdrop-filter: blur(var(--glass-blur)); --ico: var(--ico-md); }
.stage-close:hover { color: var(--fg); background: var(--glass-hover); }
.stage-main { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; background: var(--canvas); container: retrospect-stage / inline-size; }
.stage-image-view { position: relative; display: flex; flex: 1; flex-direction: column; min-height: 0; }
.stage-panes { display: flex; flex: 1; min-height: 0; gap: var(--sp-5); padding: var(--sp-4) calc(var(--stage-float-reserve) + var(--sp-4)) var(--sp-4) var(--sp-4); }
.stage-pane { position: relative; margin: 0; min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: var(--sp-2); container: image-pane / inline-size; }
.stage-detail { position: absolute; top: 64px; right: var(--sp-4); z-index: 4; width: var(--detail-width); height: max-content; max-height: min(820px, calc(100% - 88px)); }
.stage-panel[data-detail-mode="sidebar"] .stage-detail { top: 0; right: 0; bottom: 0; height: auto; max-height: none; }
.retrospect-ended { flex: none; font-size: var(--fz-2xs); color: var(--fg-3); }
.stage-action-buttons { display: flex; align-items: center; justify-content: flex-end; gap: var(--sp-2); }
.stage-feedback { color: var(--fg-3); font-size: var(--fz-xs); margin: 0 0 var(--sp-2); }
.stage-feedback.failed { color: var(--err); }
.stage-restore-notice { position: absolute; top: var(--sp-4); left: 50%; z-index: 5; max-width: calc(100% - 128px); margin: 0; padding: var(--sp-2) var(--sp-4); transform: translateX(-50%); border-radius: 999px; background: var(--glass-bg); box-shadow: 0 0 0 1px var(--line-2); color: var(--fg-2); font-size: var(--fz-xs); pointer-events: none; }
.stage-restore-notice.failed { color: var(--err); }
@media (max-width: 1180px) and (min-width: 861px) {
  .stage-panel { width: calc(100vw - 24px); height: calc(100dvh - 24px); }
}
@media (max-width: 860px) {
  .stage-panel { width: 100%; height: 100dvh; margin: 0; border: 0; border-radius: 0; }
  .stage-panel[data-detail-open][data-detail-mode] { --stage-float-reserve: 0px; }
  .stage-panel[data-detail-open][data-detail-mode] .stage-close { right: var(--sp-4); }
  .stage-detail, .stage-panel[data-detail-mode="sidebar"] .stage-detail { top: 60px; left: auto; right: var(--sp-3); width: min(420px, calc(100% - 24px)); bottom: calc(var(--stage-dock-space, 112px) + var(--sp-3)); height: auto; max-height: none; }
  .stage-panes { padding-top: 56px; }
  .stage-panes.paired { flex-direction: column; gap: var(--sp-3); }
  .stage-action-buttons > button { flex: 1; }
}
</style>
