import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import type { Chat } from "../services/chat";
export const chatKey: InjectionKey<Chat> = Symbol("chat");
export function useChat() {
  const chat = inject(chatKey);
  if (!chat) throw new Error("Chat unavailable");
  const view = shallowRef(chat.snapshot());
  const stop = chat.subscribe(() => (view.value = chat.snapshot()));
  onScopeDispose(stop);
  return { chat, view };
}
