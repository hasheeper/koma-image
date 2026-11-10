export interface TextChange { readonly kind: 'same' | 'del' | 'ins'; readonly text: string }

/** Exact, bounded LCS. Shared ends never consume the quadratic work budget. */
function tokenDiff(a: readonly string[], b: readonly string[]): TextChange[] {
  const result: TextChange[] = [];
  const append = (kind: TextChange['kind'], text: string) => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) result[result.length - 1] = { kind, text: last.text + text };
    else result.push({ kind, text });
  };
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  append('same', a.slice(0, start).join(''));
  const rows = endA - start, cols = endB - start;
  if (!rows || !cols || rows * cols > 250_000) {
    append('del', a.slice(start, endA).join(''));
    append('ins', b.slice(start, endB).join(''));
  } else {
    const width = cols + 1, table = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--)
      table[i * width + j] = a[start + i] === b[start + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < rows || j < cols) {
      if (i < rows && j < cols && a[start + i] === b[start + j]) { append('same', a[start + i++]); j++; }
      else if (i < rows && (j === cols || table[(i + 1) * width + j] >= table[i * width + j + 1])) append('del', a[start + i++]);
      else append('ins', b[start + j++]);
    }
  }
  append('same', a.slice(endA).join(''));
  return result;
}

/** Lossless tokens; CJK text does not rely on spaces. Keep combining marks with their character. */
export function textDiff(before: string, after: string): TextChange[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  const split = (s: string) => s.match(/\s+|[,，]|::|[{}\[\]():]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]\p{M}*|[^\s,，:{}\[\]()\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [];
  return tokenDiff(split(before), split(after));
}

/** Compact context units: whole tags/clauses, including nested NAI weights and brackets. */
function contextTokens(text: string): string[] {
  const result: string[] = [], stack: string[] = [];
  let start = 0;
  const flush = (end: number) => {
    const chunk = text.slice(start, end), match = chunk.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    result.push(...match.slice(1).filter(Boolean)); start = end;
  };
  for (const match of text.matchAll(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*::|::|[{}\[\]()]|[,，;；。！？!?\n]|\.(?=\s|$)/gu)) {
    const token = match[0], at = match.index;
    if (token.endsWith('::') && token !== '::') stack.push('::');
    else if (token === '::') { if (stack.at(-1) === '::') stack.pop(); }
    else if ('{[('.includes(token)) stack.push(({ '{': '}', '[': ']', '(': ')' } as Record<string, string>)[token]);
    else if ('}])'.includes(token)) { if (stack.at(-1) === token) stack.pop(); }
    else if (!stack.length) { flush(at); result.push(token); start = at + token.length; }
  }
  flush(text.length);
  return result;
}

/** Context is readable, while parts still identify only the exact edits inside each hunk. */
export function textHunks(before: string, after: string) {
  const result: { before: string; after: string }[] = [];
  let open: { before: string; after: string } | null = null;
  const parts = tokenDiff(contextTokens(before), contextTokens(after));
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === 'same') {
      if (open && /^[\s,，;；。！？!?.]*$/.test(part.text) && parts[i + 1] && parts[i + 1].kind !== 'same') {
        open.before += part.text; open.after += part.text;
      } else open = null;
    } else {
      if (!open) { open = { before: '', after: '' }; result.push(open); }
      open[part.kind === 'del' ? 'before' : 'after'] += part.text;
    }
  }
  return result.map(hunk => ({ ...hunk, parts: textDiff(hunk.before, hunk.after) }));
}
