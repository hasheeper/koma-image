/** Page-memory conversations (doc ask-window-v5 §5.1); plain data, no Vue. */
export const CONVERSATION_LIMIT = 20;
export const UNTITLED = "新对话";

export interface ConversationOrigin { readonly conversationId: string; readonly turnId: number }
export interface ConversationCore {
  readonly id: string;
  title: string;
  /** Set for a fork; only its icon depends on it. */
  readonly origin: ConversationOrigin | null;
}

/** The question's first line, whitespace collapsed, at most 60 characters. */
export const titleOf = (question: string, fallback = "") =>
  (question.split("\n").find((line) => line.trim()) ?? fallback).replace(/\s+/g, " ").trim().slice(0, 60) || UNTITLED;

/**
 * The list keeps creation order and shows the newest first. A conversation is
 * empty until its first turn, and at most one is empty at a time.
 */
export function createConversations<T extends ConversationCore>(options: {
  make(id: string): T;
  empty(conversation: T): boolean;
  limit?: number;
}) {
  const limit = options.limit ?? CONVERSATION_LIMIT, items: T[] = [];
  let sequence = 0;
  const add = (build: (id: string) => T) => {
    const conversation = build(`conversation-${++sequence}`);
    items.push(conversation);
    return conversation;
  };
  let current = add(options.make);
  return {
    get current() {
      return current;
    },
    get size() {
      return items.length;
    },
    list(): readonly T[] {
      return [...items].reverse();
    },
    get(id: string) {
      return items.find((c) => c.id === id) ?? null;
    },
    /** Switches to the empty conversation if there is one; otherwise makes it. */
    fresh(): T | "limit" {
      const empty = items.find(options.empty);
      if (empty) return (current = empty);
      return items.length >= limit ? "limit" : (current = add(options.make));
    },
    select(id: string) {
      const found = items.find((c) => c.id === id);
      if (found) current = found;
      return found ?? null;
    },
    /** A conversation built from another; it becomes current. */
    fork(build: (id: string) => T): T | "limit" {
      return items.length >= limit ? "limit" : (current = add(build));
    },
    /** Removing the current one moves to the newest left, or to a new empty one. */
    remove(id: string) {
      const at = items.findIndex((c) => c.id === id);
      if (at < 0) return null;
      const [gone] = items.splice(at, 1);
      if (gone === current) current = items.at(-1) ?? add(options.make);
      return gone;
    },
  };
}
