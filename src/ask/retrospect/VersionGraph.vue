<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, shallowRef, useTemplateRef, watch } from 'vue';
import VersionNode from './VersionNode.vue';
import WorkshopNode from './WorkshopNode.vue';
import GraphTools from './GraphTools.vue';
import AppIcon from '../../shared/AppIcon.vue';
import { placeContinuation, graphEdges } from './continuation.ts';
import { placeStagedSibling } from './staged-layout.ts';
import { MAX_EVOLUTION_NODES, isStaged } from './model.ts';
import { nodeNoteKey, edgeNoteKey } from './annotations.ts';

import type { Retrospect, RetrospectNode, RetrospectEdge } from './model.ts';
import type { GraphObject, GraphTool, SelectionMode, ReviewPicture, NoteTarget, Point, NodeLayout, ContinuationAnchor, GraphCamera } from './view.ts';
import type { ReviewNotes } from './annotations.ts';
import type { EvolutionCursor } from './store.ts';
import { NODE_META_ROOM, NODE_STACK_ROOM, NODE_FOOTER_ROOM, nodeChrome } from './node-chrome.ts';
const props = defineProps<{ workshops?: readonly { id: string; target: string; name: string; parentId: string; available: boolean; ended: boolean }[]; graph: Retrospect; generatingNodes?: ReadonlySet<string>; nodeLayout?: NodeLayout; continuationAnchor?: ContinuationAnchor | null; graphCamera?: GraphCamera | null; newNodes?: ReadonlySet<string>; cursor?: EvolutionCursor; pending?: (EvolutionCursor & { key: string }) | null; cursorPicture?: ReviewPicture; restoreDisabled?: boolean; finalNode?: string; finalPath?: ReadonlySet<string>; selected: string; baseline: string; pictures: Record<string, ReviewPicture>; backPictures: Record<string, readonly ReviewPicture[]>; active: boolean; notes: ReviewNotes; readonly: boolean }>();
const emit = defineEmits<{ openWorkshop: [id: string]; cancelWorkshop: [id: string]; select: [node: RetrospectNode, shift: boolean]; open: [node: RetrospectNode]; sample: [node: RetrospectNode, id: string]; restore: [node: RetrospectNode]; continue: []; arrange: [positions: NodeLayout]; arrangeContinuation: [anchor: ContinuationAnchor]; rememberCamera: [camera: GraphCamera]; annotate: [target: NoteTarget]; camera: []; selection: [items: readonly GraphObject[]] }>();
const surface = useTemplateRef<HTMLElement>('surface'), viewport = useTemplateRef<HTMLElement>('viewport'), world = useTemplateRef<HTMLElement>('world'), marquee = useTemplateRef<HTMLElement>('marquee');
const frameArea = useTemplateRef<HTMLElement>('frameArea');
const percent = shallowRef(100), dragging = shallowRef(false), spacePan = shallowRef(false);
const tool = shallowRef<GraphTool>('select'), selectionMode = shallowRef<SelectionMode>('single'), picked = shallowRef(new Set<string>());
const continuationKey = 'continuation';
const modeLabel = computed(() => tool.value === 'view' ? '浏览' : tool.value === 'pan' ? '平移' : tool.value === 'annotate' ? '批注' : { single: '单选', multi: '多选', box: '框选' }[selectionMode.value]);
const MAX_NODE_WIDTH = 336, MAX_NODE_HEIGHT = 320, COLUMN_GAP = 128, ROW_GAP = 48;
function fitSize(width: unknown, height: unknown) {
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const factor = Math.min(MAX_NODE_WIDTH / width, MAX_NODE_HEIGHT / height);
  return { width: width * factor, height: height * factor };
}
const ticketMap = computed(() => new Map((props.workshops ?? []).map(t => [t.id, t])));
// Tickets join the disposable layout only; they never acquire a version or recipe in stored data.
const sceneGraph = computed(() => ({ ...props.graph,
  nodes: [...props.graph.nodes, ...(props.workshops ?? []).flatMap(t => {
    const parent = props.graph.nodes.find(n => n.id === t.parentId);
    return parent ? [{ id: t.id, label: t.name, image_ids: [], cover: '', recipe: parent.recipe }] : [];
  })],
  edges: [...props.graph.edges, ...(props.workshops ?? []).map(t => ({ from: t.parentId, to: t.id, summary: '待交付' }))],
}));
function nodeSize(node: RetrospectNode) {
  if (ticketMap.value.has(node.id)) return { width: 240, height: NODE_META_ROOM + 44 + NODE_FOOTER_ROOM, imageWidth: 240, imageHeight: 44 };
  const picture = props.pictures[node.id];
  const recipe = (picture && node.recipes?.[picture.id]) ?? node.recipe;
  const image = fitSize(picture?.width, picture?.height) ?? fitSize(recipe.params.width, recipe.params.height) ?? fitSize(1, 1)!;
  return { imageWidth: image.width, imageHeight: image.height, width: Math.max(168, image.width), height: NODE_META_ROOM + image.height + NODE_FOOTER_ROOM };
}
// Positions are a disposable view of the existing forest, never editable history.
const layout = computed(() => {
  const byId = new Map(sceneGraph.value.nodes.map(node => [node.id, node]));
  const children = new Map<string, string[]>(sceneGraph.value.nodes.map(node => [node.id, []]));
  const childIds = new Set(sceneGraph.value.edges.map(edge => edge.to));
  const intents = new Map(sceneGraph.value.edges.map(edge => [edge.to, edge.summary]));
  sceneGraph.value.edges.forEach(edge => children.get(edge.from)?.push(edge.to));
  const pending: { node: RetrospectNode; summary: string; depth: number; row: number; width: number; height: number; imageWidth: number; imageHeight: number }[] = [], visited = new Set<string>();
  const columnWidths: number[] = [], rowHeights: number[] = [];
  let nextRow = 0;
  function place(id: string, depth: number) {
    const node = byId.get(id); if (!node || visited.has(id)) return;
    visited.add(id);
    const row = nextRow, branches = (children.get(id) ?? []).filter(child => !isStaged(byId.get(child)!));
    const size = nodeSize(node);
    columnWidths[depth] = Math.max(columnWidths[depth] ?? 0, size.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height);
    pending.push({ node, summary: intents.get(id) || node.label, depth, row, ...size });
    if (branches.length) branches.forEach(child => place(child, depth + 1));
    else nextRow++;
  }
  sceneGraph.value.nodes.filter(node => !isStaged(node) && !childIds.has(node.id)).forEach(node => { place(node.id, 0); });
  const columnStarts: number[] = [], rowStarts: number[] = [];
  columnWidths.forEach((_, i) => { columnStarts[i] = i ? columnStarts[i - 1] + columnWidths[i - 1] + COLUMN_GAP : 0; });
  rowHeights.forEach((_, i) => { rowStarts[i] = i ? rowStarts[i - 1] + rowHeights[i - 1] + ROW_GAP : 0; });
  let nodes = pending.map(item => ({ ...item,
    x: columnStarts[item.depth] + (columnWidths[item.depth] - item.width) / 2,
    y: rowStarts[item.row] + (rowHeights[item.row] - item.height) / 2,
  }));
  const staged = sceneGraph.value.nodes.filter(isStaged).map(node => ({ node, summary: intents.get(node.id) || node.label, depth: 0, row: 0, ...nodeSize(node), x: 0, y: 0 }));
  nodes.push(...staged);
  if (Object.keys(props.nodeLayout ?? {}).length || staged.length) {
    const saved = props.nodeLayout ?? {};
    const placed = nodes.filter(n => saved[n.node.id]).map(n => ({ ...n,
      x: saved[n.node.id].x - (n.width - n.imageWidth) / 2,
      y: saved[n.node.id].cy - NODE_META_ROOM - n.imageHeight / 2,
    }));
    // Once arranged, preserve the old scene. New children use the same placement as the preview.
    for (const n of nodes.filter(n => !saved[n.node.id])) {
      const parent = sceneGraph.value.edges.find(e => e.to === n.node.id)?.from;
      const anchor = props.continuationAnchor, cursorNode = anchor && byId.get(anchor.nodeId);
      const blankSize = cursorNode && nodeSize(cursorNode);
      const blank = anchor && blankSize ? { x: anchor.x, y: anchor.cy - blankSize.imageHeight / 2 - NODE_META_ROOM, width: blankSize.imageWidth, height: blankSize.height } : undefined;
      const next = parent && (isStaged(n.node) ? placeStagedSibling(placed, parent, n, blank) : placeContinuation(placed, sceneGraph.value.edges, parent, { width: n.imageWidth, height: n.imageHeight }, COLUMN_GAP, ROW_GAP));
      let y = next ? next.y : n.y;
      const x = next ? next.x : n.x;
      let hit: typeof n | undefined;
      while ((hit = placed.find(p => x < p.x + p.width && x + n.width > p.x && y < p.y + p.height + ROW_GAP && y + n.height + ROW_GAP > p.y)))
        y = hit.y + hit.height + ROW_GAP;
      placed.push({ ...n, x, y });
    }
    nodes = nodes.map(n => placed.find(p => p.node.id === n.node.id)!);
  }
  const edges = graphEdges(nodes, sceneGraph.value.edges);
  const left = Math.min(0, ...nodes.map(n => n.x)), top = Math.min(0, ...nodes.map(n => n.y));
  const right = Math.max(1, ...nodes.map(n => n.x + n.width)), bottom = Math.max(1, ...nodes.map(n => n.y + n.height));
  return { nodes, edges, left, top, right, bottom };
});

const continuation = computed(() => {
  const cursor = props.pending, node = props.graph.nodes.find(n => n.id === cursor?.nodeId);
  if (props.readonly || props.finalNode || !cursor || !node?.image_ids.includes(cursor.imageId)) return null;
  const recipe = node.recipes?.[cursor.imageId] ?? node.recipe;
  const image = fitSize(props.cursorPicture?.width, props.cursorPicture?.height) ?? fitSize(recipe.params.width, recipe.params.height) ?? fitSize(1, 1)!;
  return placeContinuation(layout.value.nodes, props.graph.edges, cursor.nodeId, image, COLUMN_GAP, ROW_GAP, props.continuationAnchor?.nodeId === cursor.nodeId ? props.continuationAnchor : undefined);
});
const sceneBounds = computed(() => {
  const scene = layout.value, ghost = continuation.value;
  const left = Math.min(scene.left, ghost?.x ?? 0), top = Math.min(scene.top, ghost?.y ?? 0);
  const right = Math.max(scene.right, ghost ? ghost.x + ghost.width : 0), bottom = Math.max(scene.bottom, ghost ? ghost.y + ghost.height : 0);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
});
function anchors(nodes = layout.value.nodes): NodeLayout {
  return Object.fromEntries(nodes.map(n => [n.node.id, props.nodeLayout?.[n.node.id] ?? { x: n.x + (n.width - n.imageWidth) / 2, cy: n.y + NODE_META_ROOM + n.imageHeight / 2, z: 0 }]));
}
const atCapacity = computed(() => !props.pending && sceneGraph.value.nodes.length >= MAX_EVOLUTION_NODES);
const continuationHint = computed(() => atCapacity.value ? '已达 80 个版本，请 ASK 合并归纳阶段后继续新增；续抽仍可归入原版本'
  : `从 ${props.pending?.nodeId} · ${props.pending?.imageId} 新建版本\n返回画板手动生成，结果将填入此占位；期间微调不另拆节点`);

const objects = computed<GraphObject[]>(() => [
  ...props.graph.nodes.map(node => ({ kind: 'node' as const, node, key: nodeNoteKey(node.id), title: node.id })),
  ...props.graph.edges.map(edge => ({ kind: 'edge' as const, edge, key: edgeNoteKey(edge), title: `${edge.from} → ${edge.to}` })),
]);
function selectKeys(keys: Iterable<string>) {
  picked.value = new Set(keys);
  emit('selection', objects.value.filter(item => picked.value.has(item.key)));
}
function setTool(value: GraphTool) { if (value === 'annotate' && props.readonly) return; releaseGesture(); emit('camera'); tool.value = value; viewport.value?.focus({ preventScroll: true }); }
function setMode(value: SelectionMode) { selectionMode.value = value; setTool('select'); }
function toggleTool(value: GraphTool) {
  if (value === 'annotate' && props.readonly) return;
  if (tool.value === value) { setTool('view'); selectKeys([]); return; }
  setTool(value);
  // A selected target is already explicit: the toolbar click starts its editor.
  const targets = objects.value.filter(item => picked.value.has(item.key));
  if (value === 'annotate' && targets.length) openAnnotation(targets);
}
function worldBox(item: GraphObject) {
  if (item.kind === 'node') {
    const position = layout.value.nodes.find(n => n.node.id === item.node.id)!;
    const chrome = nodeChrome(scale), node = item.node;
    const hasFooter = props.newNodes?.has(node.id) || node.id === props.selected || node.id === props.baseline || node.id === props.finalNode || node.image_ids.length > 1 || isStaged(node) && (node.id === props.cursor?.nodeId || props.generatingNodes?.has(node.id));
    return { left: position.x, top: position.y + NODE_META_ROOM - chrome.height, right: position.x + position.width,
      bottom: position.y + NODE_META_ROOM + position.imageHeight + NODE_STACK_ROOM + (hasFooter ? chrome.footerHeight : 0) };
  }
  const edge = layout.value.edges.find(e => edgeNoteKey(e) === item.key)!;
  return { left: edge.x - 3, top: edge.y - 3, right: edge.x + 3, bottom: edge.y + 3 };
}
function targetBounds(items: readonly GraphObject[]) {
  const boxes = items.map(worldBox), host = viewport.value!.getBoundingClientRect();
  return { left: host.left + x + Math.min(...boxes.map(b => b.left)) * scale,
    right: host.left + x + Math.max(...boxes.map(b => b.right)) * scale,
    top: host.top + y + Math.min(...boxes.map(b => b.top)) * scale,
    bottom: host.top + y + Math.max(...boxes.map(b => b.bottom)) * scale };
}
function openAnnotation(items: readonly GraphObject[]) {
  emit('annotate', { key: items.map(o => o.key).join('|'), items, title: items.map(o => o.title).join('、'), viewport: viewport.value!, bounds: () => targetBounds(items) });
}
function activate(item: GraphObject, event: MouseEvent | KeyboardEvent) {
  if (tool.value === 'pan' || spacePan.value || suppressClick && event.detail) return;
  if (tool.value === 'view') { if (picked.value.has(continuationKey)) selectKeys([]); if (item.kind === 'node') emit('select', item.node, event.shiftKey); return; }
  if (tool.value === 'annotate') {
    const items = picked.value.size > 1 && picked.value.has(item.key) ? objects.value.filter(o => picked.value.has(o.key)) : [item];
    openAnnotation(items);
    return;
  }
  emit('camera');
  if (selectionMode.value === 'multi') {
    const next = new Set(picked.value); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); selectKeys(next);
  } else if (selectionMode.value === 'box' && event.shiftKey) selectKeys([...picked.value, item.key]);
  else selectKeys(picked.value.size === 1 && picked.value.has(item.key) ? [] : [item.key]);
  if (selectionMode.value === 'single' && item.kind === 'node') emit('select', item.node, event.shiftKey);
}
function activateNode(node: RetrospectNode, event: MouseEvent) { activate(objects.value.find(o => o.key === nodeNoteKey(node.id))!, event); }
function activateContinuation(event: MouseEvent | KeyboardEvent) {
  if (tool.value === 'pan' || tool.value === 'annotate' || spacePan.value || suppressClick && event.detail) return;
  if (tool.value === 'select' && (selectionMode.value === 'multi' || selectionMode.value === 'box' && event.shiftKey)) {
    const next = new Set(picked.value); if (next.has(continuationKey)) next.delete(continuationKey); else next.add(continuationKey); selectKeys(next);
  } else selectKeys(picked.value.size === 1 && picked.value.has(continuationKey) ? [] : [continuationKey]);
}
function activateEdge(edge: RetrospectEdge, event: MouseEvent | KeyboardEvent) {
  if (ticketMap.value.has(edge.to)) return; activate(objects.value.find(o => o.key === edgeNoteKey(edge))!, event); }
function openNode(node: RetrospectNode) { if (!isStaged(node) && !suppressClick && performance.now() - lastNodeDrag > 400 && !spacePan.value && (tool.value === 'view' || tool.value === 'select' && selectionMode.value === 'single')) emit('open', node); }

let scale = props.graphCamera?.scale ?? 1, fitted = props.graphCamera?.fitted ?? 1, x = props.graphCamera?.x ?? 0, y = props.graphCamera?.y ?? 0;
let initialized = !!props.graphCamera, manualCamera = !!props.graphCamera, overviewCamera = props.graphCamera?.overview ?? false;
let observer: ResizeObserver | undefined;
function rememberCamera() { if (initialized) emit('rememberCamera', { x, y, scale, fitted, overview: overviewCamera }); }
const pointers = new Map<number, Point>();
let previous: Point | null = null, boxDrag: { pointer: number; start: Point; end: Point; base: string[] } | null = null, panStart: { x: number; y: number; blank: boolean } | null = null, suppressClick = false;
function paintGrid() {
  const style = surface.value?.style; if (!style) return;
  // Neighboring world-space grids share their origin; cross-fade before changing density.
  const octave = -Math.log2(scale), level = Math.max(0, Math.floor(octave));
  const fine = 24 * scale * 2 ** level, coarse = fine * 2;
  const transition = Math.max(0, Math.min(1, (octave - level - .8) / .2));
  const blend = transition * transition * (3 - 2 * transition);
  const visibility = Math.max(0, Math.min(1, (scale - .15) / .15));
  const dpr = window.devicePixelRatio || 1, atX = Math.round(x * dpr) / dpr, atY = Math.round(y * dpr) / dpr;
  style.backgroundSize = `${fine}px ${fine}px, ${coarse}px ${coarse}px`;
  style.backgroundPosition = `${atX - fine / 2}px ${atY - fine / 2}px, ${atX - coarse / 2}px ${atY - coarse / 2}px`;
  style.setProperty('--grid-fine-visibility', `${(1 - blend) * visibility * 100}%`);
  style.setProperty('--grid-coarse-visibility', `${blend * visibility * 100}%`);
}
function paint() {
  const host = frameArea.value, scene = world.value;
  if (!host || !scene || !host.clientWidth || !host.clientHeight) return;
  emit('camera');
  scene.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  const chrome = nodeChrome(scale);
  scene.style.setProperty('--graph-scale', String(scale));
  scene.style.setProperty('--node-ui-scale', String(chrome.compensation));
  scene.style.setProperty('--node-status-height', `${chrome.statusHeight}px`);
  scene.style.setProperty('--node-status-gap', `${chrome.statusGap}px`);
  if (scene.dataset.detailLevel !== chrome.level) scene.dataset.detailLevel = chrome.level;
  paintGrid();
  const next = Math.round(scale * 100); if (percent.value !== next) percent.value = next;
}
function frame() {
  const host = frameArea.value; if (!host?.clientWidth || !host.clientHeight) return;
  fitted = Math.min(1, (host.clientWidth - 40) / sceneBounds.value.width, (host.clientHeight - 32) / sceneBounds.value.height);
  // The opening view favors readable images; fit-all remains an explicit overview.
  scale = Math.max(.05, Math.min(2, fitted));
  const selectedNode = props.graph.nodes.find(n => n.id === props.selected);
  const presetParent = selectedNode && isStaged(selectedNode) ? props.graph.edges.find(e => e.to === selectedNode.id)?.from : undefined;
  const siblings = presetParent ? props.graph.edges.filter(e => e.from === presetParent).map(e => e.to) : [];
  const focus = layout.value.nodes.filter(item => item.node.id === props.selected || item.node.id === props.baseline || siblings.length <= 4 && siblings.includes(item.node.id));
  if (!overviewCamera && focus.length) {
    const left = Math.min(...focus.map(item => item.x)), right = Math.max(...focus.map(item => item.x + item.width));
    const top = Math.min(...focus.map(item => item.y)), bottom = Math.max(...focus.map(item => item.y + item.height));
    scale = presetParent
      ? Math.max(.05, Math.min(.85, (host.clientWidth - 64) / (right - left), (host.clientHeight - 112) / (bottom - top)))
      : Math.max(.05, Math.min(2, fitted * 1.45));
    x = (host.clientWidth - (left + right) * scale) / 2;
    y = (host.clientHeight - (top + bottom) * scale) / 2;
  } else {
    x = (host.clientWidth - (sceneBounds.value.left + sceneBounds.value.right) * scale) / 2;
    y = (host.clientHeight - (sceneBounds.value.top + sceneBounds.value.bottom) * scale) / 2;
  }
  initialized = true; manualCamera = false; paint();
}
function fit() { overviewCamera = true; frame(); }
function zoom(next: number, clientX?: number, clientY?: number) {
  const host = viewport.value; if (!host || !initialized) return;
  const rect = host.getBoundingClientRect();
  const atX = clientX == null ? (frameArea.value?.clientWidth ?? rect.width) / 2 : clientX - rect.left;
  const atY = clientY == null ? (frameArea.value?.clientHeight ?? rect.height) / 2 : clientY - rect.top;
  const nextScale = Math.max(Math.min(fitted, .25), Math.min(2, next)), ratio = nextScale / scale;
  x = atX - (atX - x) * ratio; y = atY - (atY - y) * ratio;
  scale = nextScale; manualCamera = true; paint();
}
function wheel(event: WheelEvent) { if (!boxDrag) { zoom(scale * Math.exp(-event.deltaY * .002), event.clientX, event.clientY); if (nodeDrag?.started) scheduleNodeDrag(); } }
function toolZoom(value: string) { zoom(value === 'actual' ? 1 : scale * (value === 'in' ? 1.25 : .8)); }
function gesture() {
  const list = [...pointers.values()];
  return list.length > 1 ? { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2, distance: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) } : list[0];
}
function localPoint(event: PointerEvent) { const rect = viewport.value!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
type SceneNode = (typeof layout.value.nodes)[number];
let lastNodeDrag = -Infinity, dragFrame = 0;
let nodeDrag: { pointer: number; start: Point; latest: Point; grip: Point; threshold: number; started: boolean;
  node: SceneNode | null; origin: { x: number; y: number; width: number; imageWidth: number; imageHeight: number };
  next: Point; element: HTMLElement } | null = null;
function paintEdges(edges: ReturnType<typeof graphEdges>) {
  for (const edge of edges) {
    const host = world.value?.querySelector(`[data-edge-from="${edge.from}"][data-edge-to="${edge.to}"]`);
    host?.querySelectorAll('path').forEach(path => path.setAttribute('d', edge.path));
    const dot = host?.querySelector('circle'); dot?.setAttribute('cx', String(edge.x)); dot?.setAttribute('cy', String(edge.y));
  }
}
// One coordinate writer for nodes and their ports, after Vue patches and on every drag frame.
// Generation progress refreshes picture metadata; it must not restore an old SVG path or placement.
function paintScene() {
  const host = world.value; if (!host) return;
  const drag = nodeDrag?.started ? nodeDrag : null;
  viewport.value?.classList.toggle('node-dragging', !!drag);
  const nodes = layout.value.nodes.map(n => n.node.id === drag?.node?.node.id ? { ...n, ...drag.next } : n);
  for (const node of nodes) {
    const element = host.querySelector<HTMLElement>(`[data-node="${node.node.id}"]`);
    if (element) {
      element.style.left = `${node.x}px`; element.style.top = `${node.y}px`;
      element.classList.toggle('node-drag-active', element === drag?.element);
    }
  }
  paintEdges(graphEdges(nodes, sceneGraph.value.edges));
  const ghost = continuation.value;
  if (ghost && props.pending) {
    const anchor = drag && !drag.node ? { x: drag.next.x, cy: drag.next.y + ghost.imageHeight / 2 }
      : { x: ghost.left, cy: ghost.top + ghost.imageHeight / 2 };
    const preview = placeContinuation(nodes, props.graph.edges, props.pending.nodeId,
      { width: ghost.imageWidth, height: ghost.imageHeight }, COLUMN_GAP, ROW_GAP, anchor);
    const element = host.querySelector<HTMLElement>('.continuation-frame');
    if (preview && element) {
      element.style.left = `${preview.left}px`; element.style.top = `${preview.top}px`;
      element.classList.toggle('node-drag-active', element === drag?.element);
      host.querySelector('.continuation-line')?.setAttribute('d', preview.path);
    }
  }
}
function dragOriginChanged() {
  const drag = nodeDrag; if (!drag) return false;
  if (!drag.node && drag.element.dataset.origin !== props.pending?.nodeId) return true;
  const ghost = continuation.value;
  const current = drag.node ? layout.value.nodes.find(n => n.node.id === drag.node!.node.id)
    : ghost ? { x: ghost.left, y: ghost.top, width: ghost.imageWidth, imageWidth: ghost.imageWidth, imageHeight: ghost.imageHeight } : null;
  return !current || (['x', 'y', 'width', 'imageWidth', 'imageHeight'] as const).some(key => current[key] !== drag.origin[key]);
}
function scheduleNodeDrag() { if (!dragFrame) dragFrame = requestAnimationFrame(drawNodeDrag); }
function drawNodeDrag() {
  dragFrame = 0;
  const drag = nodeDrag, host = viewport.value; if (!drag?.started || !host) return;
  const rect = host.getBoundingClientRect(), frame = frameArea.value!.getBoundingClientRect();
  // Pan only while near an edge, so a node can be placed beyond the opening viewport.
  const speed = (point: number, start: number, end: number) => point < start + 24 ? Math.min(12, (start + 24 - point) / 2)
    : point > end - 24 ? -Math.min(12, (point - end + 24) / 2) : 0;
  const dx = speed(drag.latest.x, rect.left, frame.right), dy = speed(drag.latest.y, rect.top, rect.bottom);
  if (dx || dy) { x += dx; y += dy; manualCamera = true; paint(); }
  drag.next = { x: (drag.latest.x - rect.left - x) / scale - drag.grip.x, y: (drag.latest.y - rect.top - y) / scale - drag.grip.y };
  paintScene();
  if (dx || dy) scheduleNodeDrag();
}
function finishNodeDrag(cancelled: boolean) {
  const drag = nodeDrag; if (!drag) return;
  if (dragFrame) cancelAnimationFrame(dragFrame); dragFrame = 0;
  if (drag.started && !cancelled) {
    // Flush the last pointer position even if pointerup arrived before the next frame.
    drawNodeDrag(); if (dragFrame) cancelAnimationFrame(dragFrame); dragFrame = 0;
    const saved = { ...anchors() }, z = Math.max(props.continuationAnchor?.z ?? 0, ...Object.values(saved).map(p => p.z)) + 1;
    if (drag.node) saved[drag.node.node.id] = { x: drag.next.x + (drag.node.width - drag.node.imageWidth) / 2,
      cy: drag.next.y + NODE_META_ROOM + drag.node.imageHeight / 2, z };
    drag.element.style.zIndex = String(z);
    nodeDrag = null;
    emit('arrange', saved);
    if (!drag.node && props.pending) emit('arrangeContinuation', { nodeId: props.pending.nodeId, x: drag.next.x, cy: drag.next.y + drag.origin.imageHeight / 2, z });
    void nextTick(paintScene);
  } else {
    nodeDrag = null;
    if (drag.started) {
      drag.element.style.zIndex = String(drag.node ? props.nodeLayout?.[drag.node.node.id]?.z ?? 0 : props.continuationAnchor?.z ?? 0);
      paintScene();
    }
  }
  drag.element.classList.remove('node-drag-active');
  viewport.value?.classList.remove('node-dragging');
  if (drag.started) { suppressClick = true; lastNodeDrag = performance.now(); }
  if (viewport.value?.hasPointerCapture(drag.pointer)) viewport.value.releasePointerCapture(drag.pointer);
}
function down(event: PointerEvent) {
  if (![0, 1].includes(event.button) || (event.target as Element).closest('[data-node-control]')) return;
  if (boxDrag || nodeDrag) return;
  suppressClick = false;
  const onObject = !!(event.target as Element).closest('.node-image, .node-meta, .node-pin, .graph-edge, .continuation-frame');
  const pan = event.button === 1 || tool.value === 'pan' || spacePan.value;
  const movable = (event.target as Element).closest('.node-image, .node-meta, .continuation-frame');
  if (!pan && movable && (tool.value === 'view' || tool.value === 'select' && selectionMode.value === 'single')) {
    const ghost = movable.classList.contains('continuation-frame');
    const element = ghost ? movable as HTMLElement : movable.closest<HTMLElement>('[data-node]');
    const node = ghost ? null : layout.value.nodes.find(n => n.node.id === element?.dataset.node) ?? null;
    const origin = node ?? (ghost && continuation.value ? { x: continuation.value.left, y: continuation.value.top,
      width: continuation.value.imageWidth, imageWidth: continuation.value.imageWidth, imageHeight: continuation.value.imageHeight } : null);
    if (!element || !origin) return;
    const start = { x: event.clientX, y: event.clientY }, local = localPoint(event);
    nodeDrag = { pointer: event.pointerId, start, latest: start, threshold: event.pointerType === 'mouse' ? 4 : 8,
      grip: { x: (local.x - x) / scale - origin.x, y: (local.y - y) / scale - origin.y },
      started: false, node, origin, next: { x: origin.x, y: origin.y }, element };
    return;
  }
  if (onObject && !pan) return;
  event.preventDefault(); viewport.value!.focus({ preventScroll: true }); emit('camera');
  viewport.value!.setPointerCapture(event.pointerId);
  if (!pan && tool.value === 'select' && selectionMode.value === 'box') {
    const start = localPoint(event);
    boxDrag = { pointer: event.pointerId, start, end: start, base: event.shiftKey ? [...picked.value] : [] };
    return;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); previous = gesture(); dragging.value = true;
  panStart = { x: event.clientX, y: event.clientY, blank: !onObject };
}
function move(event: PointerEvent) {
  if (nodeDrag?.pointer === event.pointerId) {
    nodeDrag.latest = { x: event.clientX, y: event.clientY };
    if (!nodeDrag.started && Math.hypot(event.clientX - nodeDrag.start.x, event.clientY - nodeDrag.start.y) < nodeDrag.threshold) return;
    event.preventDefault();
    if (!nodeDrag.started) {
      nodeDrag.started = true; suppressClick = true; emit('camera');
      if (!nodeDrag.node) selectKeys([continuationKey]);
      nodeDrag.element.style.zIndex = String(Math.max(props.continuationAnchor?.z ?? 0, ...Object.values(props.nodeLayout ?? {}).map(p => p.z)) + 1);
      viewport.value?.focus({ preventScroll: true }); viewport.value?.setPointerCapture(event.pointerId);
      viewport.value?.classList.add('node-dragging'); nodeDrag.element.classList.add('node-drag-active');
    }
    scheduleNodeDrag(); return;
  }
  if (boxDrag?.pointer === event.pointerId) {
    boxDrag.end = localPoint(event);
    const left = Math.min(boxDrag.start.x, boxDrag.end.x), top = Math.min(boxDrag.start.y, boxDrag.end.y);
    const width = Math.abs(boxDrag.end.x - boxDrag.start.x), height = Math.abs(boxDrag.end.y - boxDrag.start.y);
    suppressClick ||= width + height > 4;
    const el = marquee.value!;
    el.style.display = 'block'; el.style.transform = `translate(${left}px, ${top}px)`;
    el.style.width = `${width}px`; el.style.height = `${height}px`;
    return;
  }
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const next = gesture();
  suppressClick ||= pointers.size > 1 || Math.hypot(event.clientX - panStart!.x, event.clientY - panStart!.y) > 4;
  if (previous?.distance && next.distance) zoom(scale * next.distance / previous.distance, next.x, next.y);
  if (previous) { x += next.x - previous.x; y += next.y - previous.y; manualCamera = true; paint(); }
  previous = next;
}
function up(event: PointerEvent) {
  const cancelled = event.type !== 'pointerup';
  if (nodeDrag?.pointer === event.pointerId) { finishNodeDrag(cancelled); return; }
  if (boxDrag?.pointer === event.pointerId) {
    if (!cancelled) {
      const { start, end, base } = boxDrag;
      const rect = { left: (Math.min(start.x, end.x) - x) / scale, right: (Math.max(start.x, end.x) - x) / scale,
        top: (Math.min(start.y, end.y) - y) / scale, bottom: (Math.max(start.y, end.y) - y) / scale };
      const hits = suppressClick ? objects.value.filter(item => {
        const bounds = worldBox(item);
        if (item.kind === 'edge') { const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2; return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom; }
        return bounds.right >= rect.left && bounds.left <= rect.right && bounds.bottom >= rect.top && bounds.top <= rect.bottom;
      }).map(item => item.key) : [];
      const ghost = continuation.value;
      if (suppressClick && ghost && ghost.left + ghost.imageWidth >= rect.left && ghost.left <= rect.right && ghost.top + ghost.imageHeight >= rect.top && ghost.top <= rect.bottom) hits.push(continuationKey);
      selectKeys([...base, ...hits]);
    }
    boxDrag = null; marquee.value!.style.display = 'none';
  } else if (pointers.has(event.pointerId)) {
    if (!cancelled && !suppressClick && panStart?.blank && tool.value === 'select' && !spacePan.value) selectKeys([]);
    pointers.delete(event.pointerId); previous = pointers.size ? gesture() : null; dragging.value = pointers.size > 0;
    // Free movement during the gesture; on release keep a small part reachable.
    if (!pointers.size && suppressClick && frameArea.value) {
      const bounds = sceneBounds.value, width = bounds.width * scale, height = bounds.height * scale;
      const roomW = frameArea.value.clientWidth, roomH = frameArea.value.clientHeight;
      const visibleX = Math.min(96, width, roomW / 2), visibleY = Math.min(96, height, roomH / 2);
      x = Math.max(visibleX - bounds.right * scale, Math.min(roomW - visibleX - bounds.left * scale, x));
      y = Math.max(visibleY - bounds.bottom * scale, Math.min(roomH - visibleY - bounds.top * scale, y)); paint();
    }
  }
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId);
}
function releaseGesture() {
  finishNodeDrag(true);
  const host = viewport.value, ids = [...pointers.keys(), ...(boxDrag ? [boxDrag.pointer] : [])];
  pointers.clear(); boxDrag = null; previous = null; panStart = null; dragging.value = false; spacePan.value = false;
  if (marquee.value) marquee.value!.style.display = 'none';
  ids.forEach(id => { if (host?.hasPointerCapture(id)) host.releasePointerCapture(id); });
}
function escape() {
  if (nodeDrag || boxDrag || pointers.size) { releaseGesture(); return true; }
  if (picked.value.size) { selectKeys([]); return true; }
  if (tool.value !== 'select' || selectionMode.value !== 'single') { setMode('single'); return true; }
  return false;
}
defineExpose({ escape });
function keys(event: KeyboardEvent) {
  if ((event.target as Element).closest('input, textarea, [role="menu"]') || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (nodeDrag?.started && key !== 'escape') { if (event.key === ' ') event.preventDefault(); return; }
  if (key === 'escape' && escape()) { event.preventDefault(); event.stopPropagation(); }
  else if (['h', 'v', 'm', 'n'].includes(key)) {
    event.preventDefault(); if (key === 'v' || key === 'm') setMode(key === 'v' ? 'single' : 'box'); else setTool(key === 'h' ? 'pan' : 'annotate');
  } else if (event.key === ' ' && (event.target === viewport.value || (event.target as Element).closest('.node-image, .node-meta'))) { event.preventDefault(); spacePan.value = true; }
  else if (event.target === viewport.value) {
    if (event.key === 'Home' || key === '0') { event.preventDefault(); fit(); }
    else if (key === '+' || key === '=') { event.preventDefault(); zoom(scale * 1.25); }
    else if (key === '-') { event.preventDefault(); zoom(scale / 1.25); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); x += event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0;
      y += event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0; manualCamera = true; paint();
    }
  }
}
async function visibility() {
  observer?.disconnect(); releaseGesture();
  if (!props.active) { rememberCamera(); return; }
  await nextTick(); if (!props.active || !frameArea.value) return;
  observer?.observe(frameArea.value);
  if (!initialized) frame(); else { manualCamera = true; paint(); }
}
watch(() => props.active, visibility);
watch(() => props.readonly, readonly => { if (readonly && tool.value === 'annotate') setMode('single'); });
watch([layout, continuation], () => {
  if (dragOriginChanged()) finishNodeDrag(true);
  const allowed = new Set([...objects.value.map(o => o.key), ...(continuation.value ? [continuationKey] : [])]); selectKeys([...picked.value].filter(id => allowed.has(id)));
  // Browsing samples, pinning and successful generation must not steal the camera.
  if (props.active) nextTick(() => { if (!initialized) frame(); else paint(); });
  if (layout.value.nodes.some(n => !props.nodeLayout?.[n.node.id])) emit('arrange', anchors());
  if (continuation.value && props.pending && props.continuationAnchor?.nodeId !== props.pending.nodeId) {
    emit('arrange', anchors());
    emit('arrangeContinuation', { nodeId: props.pending.nodeId, x: continuation.value.left, cy: continuation.value.top + continuation.value.imageHeight / 2, z: 0 });
  }
}, { immediate: true });
watch(() => props.pending?.key, () => { if (picked.value.has(continuationKey)) selectKeys([...picked.value].filter(key => key !== continuationKey)); });
onMounted(() => {
  observer = new ResizeObserver(() => { if (!props.active) return; if (!initialized || !manualCamera) frame(); else paint(); });
  paintScene(); visibility(); window.addEventListener('blur', releaseGesture);
});
onUpdated(paintScene);
onBeforeUnmount(() => { observer?.disconnect(); releaseGesture(); rememberCamera(); window.removeEventListener('blur', releaseGesture); });
</script>
<template>
  <section ref="surface" class="version-graph" aria-label="版本关系图" @keydown="keys" @keyup.space="spacePan = false">
    <!-- Framing avoids the inspector without clipping the canvas behind a floating window. -->
    <div ref="frameArea" class="graph-frame" aria-hidden="true"></div>
    <div ref="viewport" class="graph-viewport" :class="{ dragging, panning: tool === 'pan' || spacePan, annotating: tool === 'annotate' && !spacePan, boxing: tool === 'select' && selectionMode === 'box' && !spacePan }" tabindex="0" :aria-label="`版本关系画布，当前${modeLabel}，已选择 ${picked.size} 项`" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up" @wheel.prevent="wheel" @blur="spacePan = false">
      <div ref="world" class="graph-world" :style="{ width: `${sceneBounds.width}px`, height: `${sceneBounds.height}px` }">
        <svg class="graph-edges" :width="sceneBounds.width" :height="sceneBounds.height">
          <path v-if="continuation" class="continuation-line" aria-hidden="true" />
          <g v-for="edge in layout.edges" :key="edgeNoteKey(edge)" class="graph-edge" :data-edge-from="edge.from" :data-edge-to="edge.to" role="button" tabindex="0" :aria-label="`${edge.from} 到 ${edge.to} 连线${notes?.[edgeNoteKey(edge)] ? '，有批注' : ''}`" :aria-pressed="picked.has(edgeNoteKey(edge))" :class="{ staged: graph.nodes.some(n => n.id === edge.to && isStaged(n)), active: edge.to === selected, picked: picked.has(edgeNoteKey(edge)), 'final-path': finalPath?.has(edge.from) && finalPath?.has(edge.to) }" @click.stop="activateEdge(edge, $event)" @keydown.enter.prevent.stop="activateEdge(edge, $event)" @keydown.space.prevent.stop="activateEdge(edge, $event)" @dblclick.stop>
            <title>{{ `${edge.from} → ${edge.to} · ${notes?.[edgeNoteKey(edge)] || edge.summary}` }}</title>
            <path class="edge-hit" />
            <path class="edge-line" />
            <circle v-if="picked.has(edgeNoteKey(edge)) || notes?.[edgeNoteKey(edge)]" class="edge-dot" r="3" />
          </g>
        </svg>
        <VersionNode v-for="item in layout.nodes.filter(item => !ticketMap.has(item.node.id))" :key="item.node.id" :node="item.node" :fresh="newNodes?.has(item.node.id)" :generating="generatingNodes?.has(item.node.id)" :cursor="item.node.id === cursor?.nodeId && pictures[item.node.id]?.id === cursor.imageId" :restore-disabled="restoreDisabled || generatingNodes?.has(item.node.id) || (isStaged(item.node) ? readonly : !pictures[item.node.id]?.url || pictures[item.node.id]?.parametersUnavailable)" :final="item.node.id === finalNode" :on-final-path="!!finalPath?.has(item.node.id)" :picture="pictures[item.node.id]" :backs="backPictures[item.node.id]" :summary="item.summary" :note="notes?.[nodeNoteKey(item.node.id)]" :selected="item.node.id === selected" :baseline="item.node.id === baseline" :picked="picked.has(nodeNoteKey(item.node.id))" :tool="tool" :style="{ zIndex: nodeLayout?.[item.node.id]?.z ?? 0, '--node-width': `${item.width}px`, '--node-height': `${item.height}px`, '--image-width': `${item.imageWidth}px`, '--image-height': `${item.imageHeight}px`, '--image-min': `${Math.min(item.imageWidth, item.imageHeight)}px`, '--node-meta-room': `${NODE_META_ROOM}px`, '--node-stack-room': `${NODE_STACK_ROOM}px` }" @select="activateNode(item.node, $event)" @open="openNode(item.node)" @sample="emit('sample', item.node, $event)" @restore="emit('restore', item.node)" />
        <WorkshopNode v-for="item in layout.nodes.filter(item => ticketMap.has(item.node.id))" :key="item.node.id" :ticket="ticketMap.get(item.node.id)!" :disabled="readonly || restoreDisabled" :style="{ zIndex: nodeLayout?.[item.node.id]?.z ?? 0, width: `${item.width}px`, height: `${item.height}px`, '--node-meta-room': `${NODE_META_ROOM}px` }" @open="emit('openWorkshop', item.node.id)" @cancel="emit('cancelWorkshop', item.node.id)" />
        <div v-if="continuation" :key="pending?.key" class="continuation-frame" role="group" :aria-label="`新版本占位，可拖动${picked.has(continuationKey) ? '，已选中' : ''}`" tabindex="0" :class="{ selected: picked.has(continuationKey) }" @click.stop="activateContinuation" @keydown.enter.prevent.stop="activateContinuation" @keydown.space.prevent.stop="activateContinuation" @dblclick.stop :data-origin="pending?.nodeId" :data-origin-sample="pending?.imageId" :style="{ width: `${continuation.imageWidth}px`, height: `${continuation.imageHeight}px`, '--frame-min': `${Math.min(continuation.imageWidth, continuation.imageHeight)}px`, zIndex: continuationAnchor?.z ?? 0 }">
          <button class="ibtn continuation-add" type="button" data-node-control :disabled="atCapacity" aria-label="返回画板继续演进" :title="continuationHint" @pointerdown.stop @click.stop="emit('continue')" @dblclick.stop><AppIcon name="i-plus" /></button>
        </div>
      </div>
      <div ref="marquee" class="graph-marquee" aria-hidden="true"></div>
    </div>
    <slot name="toolbar" :tool="tool" :selection-mode="selectionMode" :percent="percent" :set-tool="toggleTool" :set-mode="setMode" :zoom="toolZoom" :fit="fit"><div class="editor-toolbar graph-tools"><GraphTools :annotation-disabled="readonly" :tool="tool" :selection-mode="selectionMode" :percent="percent" @tool="toggleTool" @mode="setMode($event as SelectionMode)" @zoom="toolZoom" @fit="fit" /></div></slot>
  </section>
</template>
<style scoped>
.version-graph {
  --grid-ink: color-mix(in srgb, var(--fg-4) 22%, transparent);
  position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden;
  background-image:
    radial-gradient(circle, color-mix(in srgb, var(--grid-ink) var(--grid-fine-visibility, 100%), transparent) .75px, transparent 1px),
    radial-gradient(circle, color-mix(in srgb, var(--grid-ink) var(--grid-coarse-visibility, 0%), transparent) .75px, transparent 1px);
  background-size: 24px 24px, 48px 48px;
}
.graph-frame { position: absolute; inset: 0 var(--stage-float-reserve, 0px) 0 0; visibility: hidden; pointer-events: none; }
.graph-viewport { position: absolute; inset: 0; overflow: hidden; touch-action: none; cursor: grab; }
.graph-viewport:focus-visible { outline: 1px solid var(--line); outline-offset: -1px; }
.graph-viewport.panning { cursor: grab; }
.graph-viewport.dragging { cursor: grabbing; }
.graph-viewport.boxing { cursor: crosshair; }
.graph-viewport.annotating { cursor: crosshair; }
.graph-viewport.node-dragging, .graph-viewport.node-dragging :deep(.node-image), .graph-viewport.node-dragging :deep(.node-meta), .graph-viewport.node-dragging .continuation-frame { cursor: grabbing; }
.graph-viewport:is(.panning, .dragging, .annotating) :deep(.node-image), .graph-viewport:is(.panning, .dragging, .annotating) .continuation-frame, .graph-viewport:is(.panning, .dragging, .annotating) .edge-hit { cursor: inherit; }
/* Native camera and hit testing must use the same transform, even under reduced motion. */
.graph-world { position: absolute; top: 0; left: 0; transform-origin: 0 0; transition: none; }
.graph-edges { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.graph-edges path { fill: none; vector-effect: non-scaling-stroke; }
.graph-edge { outline: none; }
.staged .edge-line, .continuation-line { stroke-dasharray: 4 4; }
.edge-line, .continuation-line { stroke: color-mix(in srgb, var(--fg-3) 45%, transparent); stroke-width: var(--ico-stroke); pointer-events: none; }
.final-path .edge-line { stroke: var(--a); stroke-width: var(--ico-stroke-strong); }
.active .edge-line { stroke: color-mix(in srgb, var(--a) 65%, var(--fg-3)); }
.graph-edge:is(:hover, :focus-visible) .edge-line { stroke: var(--fg-2); }
.picked .edge-line { stroke: var(--fg-2); stroke-width: var(--ico-stroke-strong); }
/* stylelint-disable-next-line declaration-property-value-allowed-list -- Invisible hit region for selecting graph edges, not an icon stroke. */
.edge-hit { stroke: transparent; stroke-width: 16px; pointer-events: stroke; cursor: pointer; }
.edge-dot { fill: var(--fg-2); pointer-events: none; }
.continuation-frame { position: absolute; transition: none; border: calc(1px / var(--graph-scale, 1)) dashed var(--fg-4); border-radius: min(calc(14px * var(--node-ui-scale, 1)), calc(var(--frame-min) * .1)); background: transparent; opacity: .6; pointer-events: auto; cursor: move; }
.continuation-frame:has(.continuation-add:is(:hover, :focus-visible)) { opacity: 1; }
.continuation-frame.selected { opacity: 1; border-color: var(--a); border-style: solid; box-shadow: 0 0 0 calc(.5px / var(--graph-scale, 1)) var(--a); }
.continuation-add { position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; border-radius: var(--r2); transform: translate(-50%, -50%) scale(var(--node-ui-scale, 1)); color: var(--fg-3); pointer-events: auto; --ico: var(--ico-sm); }
.continuation-add:hover:not(:disabled) { background: var(--hover); color: var(--fg-2); }
.continuation-add:focus-visible { outline: 1px solid var(--a); outline-offset: 2px; }
.continuation-frame.selected .continuation-add { background: transparent; color: var(--a); }
[data-detail-level="compact"] .continuation-add { width: 22px; height: 22px; }
[data-detail-level="overview"] .continuation-add { display: none; }
[data-detail-level="overview"] .continuation-frame { border-style: solid; }
[data-detail-level="overview"] .staged .edge-line, [data-detail-level="overview"] .continuation-line { stroke-dasharray: none; }
.graph-marquee { display: none; position: absolute; top: 0; left: 0; border: 1px solid color-mix(in srgb, var(--fg) 30%, transparent); border-radius: var(--r1); background: color-mix(in srgb, var(--fg) 5%, transparent); pointer-events: none; }
</style>
