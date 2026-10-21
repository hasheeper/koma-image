import type { AskImage, AskText, AskTool } from "./messages.ts";

export interface ToolOutcome {
  readonly content: readonly (AskText | AskImage)[];
  readonly error?: boolean;
  /** Short mono readout on the trace row, e.g. `3 处变化` or `42 KB`. */
  readonly stat?: string;
}
/**
 * Everything a tool may touch. Getters only: no store, no service, nothing
 * that writes. Drafts go through draft/apply.ts from a user click, not here.
 */
export interface ToolContext {
  readonly signal: AbortSignal;
  /** Set by「仅发元数据重试」: visual tools answer with an error this turn. */
  readonly metadataOnly: boolean;
  /** A fresh workbench snapshot as a `<workspace_state>` block. */
  readonly state: () => { readonly text: string; readonly images: number };
}
export interface ToolEntry {
  readonly tool: AskTool;
  /** Trace row wording: 正在{verb} {object} → 已{verb} {object}. */
  readonly verb: string;
  object(input: Readonly<Record<string, unknown>>): string;
  /** Ends the turn after it runs (propose_draft, A2). */
  readonly final?: boolean;
  run(
    input: Readonly<Record<string, unknown>>,
    context: ToolContext,
  ): ToolOutcome | Promise<ToolOutcome>;
}
export type ToolRegistry = ReadonlyMap<string, ToolEntry>;

const getState: ToolEntry = {
  tool: {
    name: "get_state",
    description:
      "读取工作台的最新状态（与消息末尾 <workspace_state> 同一格式）。仅当需要确认本轮开始后的变化时调用。",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
  verb: "读取",
  object: () => "工作台",
  run(_input, context) {
    const state = context.state();
    return {
      content: [{ type: "text", text: state.text }],
      stat: `${state.images} 张历史`,
    };
  },
};
/** A0.2 registers only get_state; A1 adds the rest of the read-only set. */
export function createTools(): ToolRegistry {
  return new Map([getState].map((entry) => [entry.tool.name, entry]));
}
