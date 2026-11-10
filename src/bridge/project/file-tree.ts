export interface ProjectTreeFile {
  path: string;
  title: string;
  note?: string;
  image?: string | null;
  warning?: boolean;
}

export type ProjectTreeNode =
  | { kind: 'folder'; path: string; name: string; children: ProjectTreeNode[] }
  | { kind: 'file'; path: string; name: string; file: ProjectTreeFile };

export interface ProjectTreeRow {
  node: ProjectTreeNode;
  depth: number;
  parent: string | null;
  position: number;
  size: number;
}

const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** Projects the indexed, possibly filtered file list without changing its paths. */
export function projectFileTree(files: readonly ProjectTreeFile[]): ProjectTreeNode[] {
  const roots: ProjectTreeNode[] = [], folders = new Map<string, Extract<ProjectTreeNode, { kind: 'folder' }>>(), seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const parts = file.path.split('/'), name = parts.pop()!;
    let children = roots, path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: 'folder', path, name: part, children: [] };
        folders.set(path, folder);
        children.push(folder);
      }
      children = folder.children;
    }
    children.push({ kind: 'file', path: file.path, name, file });
  }
  function sort(nodes: ProjectTreeNode[]) {
    nodes.sort((a, b) => a.kind === b.kind ? names.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1);
    for (const node of nodes) if (node.kind === 'folder') sort(node.children);
  }
  sort(roots);
  return roots;
}

export function visibleProjectTree(nodes: readonly ProjectTreeNode[], collapsed: ReadonlySet<string>): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];
  function visit(items: readonly ProjectTreeNode[], depth: number, parent: string | null) {
    items.forEach((node, index) => {
      rows.push({ node, depth, parent, position: index + 1, size: items.length });
      if (node.kind === 'folder' && !collapsed.has(node.path)) visit(node.children, depth + 1, node.path);
    });
  }
  visit(nodes, 0, null);
  return rows;
}
