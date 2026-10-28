<script setup lang="ts">
import { computed, h } from "vue";
import type { FunctionalComponent, VNodeChild } from "vue";
import type { PictureRefs } from "./edit-context.ts";
import AskReference from "./AskReference.vue";
import { blocks, inline } from "./format.ts";
import type { Block, Inline } from "./format.ts";

const props = defineProps<{ text: string; inlineOnly?: boolean; lead?: boolean; pictureRefs?: PictureRefs }>();
const content = computed(() => props.inlineOnly ? [] : blocks(props.text));
const parts = computed(() => props.inlineOnly ? inline(props.text) : []);

// Only explicit Vue nodes are created; Markdown HTML never enters innerHTML.
function renderInline(parts: readonly Inline[]): VNodeChild[] {
  return parts.map(part => {
    switch (part.t) {
      case "text": return part.v;
      case "id": return h(AskReference, { label: part.v, pictureRefs: props.pictureRefs });
      case "code": return h("code", null, part.v);
      case "br": return h("br");
      case "check": return h("input", { type: "checkbox", checked: part.checked, disabled: true, "aria-label": part.checked ? "已完成" : "未完成" });
      case "a": return h("a", { href: part.href, title: part.title, target: "_blank", rel: "noopener noreferrer" }, renderInline(part.parts));
      default: return h(part.t, null, renderInline(part.parts));
    }
  });
}
function renderBlocks(nodes: readonly Block[], lead = false, tight = false): VNodeChild[] {
  return nodes.map((node, index) => {
    switch (node.t) {
      case "p": return tight ? renderInline(node.parts) : h("p", { class: lead && index === 0 ? "ask-lead" : undefined }, renderInline(node.parts));
      case "heading": return h(`h${node.depth}`, null, renderInline(node.parts));
      case "ul": case "ol": return h(node.t, node.t === "ol" ? { start: node.start } : null,
        node.items.map(item => h("li", { class: item.task ? "ask-task-item" : undefined }, renderBlocks(item.blocks, false, !node.loose))));
      case "blockquote": return h("blockquote", null, renderBlocks(node.blocks));
      case "pre": return h("pre", { tabindex: 0, "aria-label": node.language ? `${node.language} 代码块` : "代码块" }, [h("code", node.language ? { "data-language": node.language } : null, node.text)]);
      case "hr": return h("hr");
      case "table": {
        const row = (cells: readonly (readonly Inline[])[], tag: "th" | "td") => h("tr", null, cells.map((parts, i) =>
          h(tag, { style: node.align[i] ? { textAlign: node.align[i] } : undefined, ...(tag === "th" ? { scope: "col" } : {}) }, renderInline(parts))));
        return h("div", { class: "ask-table-scroll", tabindex: 0, role: "region", "aria-label": "表格" }, [
          h("table", null, [h("thead", null, [row(node.header, "th")]), h("tbody", null, node.rows.map(cells => row(cells, "td"))) ]),
        ]);
      }
    }
  });
}
const InlineContent: FunctionalComponent<{ parts: readonly Inline[] }> = p => renderInline(p.parts);
InlineContent.props = ["parts"];
const Content: FunctionalComponent<{ nodes: readonly Block[]; lead: boolean }> = p => renderBlocks(p.nodes, p.lead);
Content.props = ["nodes", "lead"];
</script>
<template>
  <span v-if="inlineOnly" class="ask-markdown-inline"><InlineContent :parts="parts" /></span>
  <div v-else class="ask-markdown"><Content :nodes="content" :lead="!!lead" /></div>
</template>
<style scoped>
.ask-markdown, .ask-markdown-inline { min-width: 0; overflow-wrap: anywhere; }
.ask-markdown > :deep(* + *) { margin-top: 8px; }
.ask-markdown > :deep(p + p), .ask-markdown > :deep(p + ul), .ask-markdown > :deep(p + ol) { margin-top: 6px; }
.ask-markdown :deep(p) { margin-bottom: 0; white-space: normal; }
.ask-markdown :deep(h1), .ask-markdown :deep(h2), .ask-markdown :deep(h3), .ask-markdown :deep(h4), .ask-markdown :deep(h5), .ask-markdown :deep(h6) { margin: 18px 0 6px; color: var(--fg); font-weight: var(--fw-semibold); line-height: 1.5; }
.ask-markdown :deep(h1) { font-size: 17px; }
.ask-markdown :deep(h2) { font-size: 15px; }
.ask-markdown :deep(h3) { font-size: 14px; }
.ask-markdown :deep(h4), .ask-markdown :deep(h5), .ask-markdown :deep(h6) { font-size: 13px; }
.ask-markdown > :deep(:first-child) { margin-top: 0; }
.ask-markdown :deep(ul), .ask-markdown :deep(ol) { display: block; margin-bottom: 0; padding-left: 21px; }
.ask-markdown :deep(li) { margin: 3px 0; padding-left: 1px; white-space: normal; }
.ask-markdown :deep(li::marker) { color: var(--fg-3); }
.ask-markdown :deep(li > ul), .ask-markdown :deep(li > ol) { margin-top: 4px; }
.ask-markdown :deep(li > p + p) { margin-top: 8px; }
.ask-markdown :deep(blockquote) { margin-right: 0; margin-bottom: 0; margin-left: 0; padding: 2px 0 2px 12px; color: var(--fg-2); border-left: 2px solid var(--line-2); }
.ask-markdown :deep(blockquote > * + *) { margin-top: 8px; }
.ask-markdown :deep(hr) { margin: 16px 0; border: 0; border-top: 1px solid var(--line-2); }
.ask-markdown :deep(strong), .ask-markdown-inline :deep(strong) { color: var(--fg); font-weight: var(--fw-semibold); }
.ask-markdown :deep(em), .ask-markdown-inline :deep(em) { font-style: italic; font-synthesis: style; }
.ask-markdown :deep(a), .ask-markdown-inline :deep(a) { color: var(--a); text-decoration: underline; text-underline-offset: 3px; }
.ask-markdown :deep(code), .ask-markdown-inline :deep(code) { padding: 1px 5px; font: inherit; font-family: var(--mono); font-size: 12px; background: rgba(255, 255, 255, .08); border-radius: var(--r1); }
.ask-markdown :deep(pre) { max-width: 100%; margin-bottom: 0; padding: 10px 12px; overflow: auto; color: var(--fg-2); background: var(--ask-field, var(--well)); border: 1px solid var(--line); border-radius: 8px; white-space: pre; }
.ask-markdown :deep(pre code) { display: block; padding: 0; font-size: 12px; line-height: 1.65; background: none; border-radius: 0; overflow-wrap: normal; }
.ask-markdown :deep(.ask-table-scroll) { max-width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
.ask-markdown :deep(table) { width: 100%; border-collapse: collapse; font-size: 12px; }
.ask-markdown :deep(th), .ask-markdown :deep(td) { min-width: 90px; padding: 6px 9px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.ask-markdown :deep(th) { color: var(--fg); font-weight: var(--fw-medium); background: var(--ask-field, var(--well)); }
.ask-markdown :deep(tbody tr:last-child td) { border-bottom: 0; }
.ask-markdown :deep(.ask-task-item) { list-style: none; }
.ask-markdown :deep(input[type="checkbox"]) { width: 12px; height: 12px; margin: 0 6px 0 -18px; accent-color: var(--a); vertical-align: -1px; }
</style>
