import type { AskRequest, AskTool } from "../messages.ts";

export const responseTool: AskTool = {
  name: "submit_response",
  description: "提交向用户展示的回复正文。",
  schema: {
    type: "object",
    properties: { content: { type: "string", description: "完整的 Markdown 回复正文" } },
    required: ["content"],
  },
};

/** A transport preference only; business tools and plain replies remain valid. */
export function withToolResponse<T extends Pick<AskRequest, "tools" | "system">>(request: T): T {
  return {
    ...request,
    tools: [...request.tools, responseTool],
    system: [request.system[0] + "\n\n最终回复正文请通过 submit_response 的 content 提交，也可与查询或草稿工具在同一响应中提供说明。", request.system[1]],
  };
}
