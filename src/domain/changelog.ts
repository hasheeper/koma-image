export interface ReleaseGroup {
  title: string;
  items: string[];
  notes: string[];
}

export interface ReleaseNotes {
  version: string;
  date: string;
  note: string;
  groups: ReleaseGroup[];
}

/** Read the release headings, lists and paragraphs maintained in CHANGELOG.md. */
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let release: ReleaseNotes | undefined;
  let group: ReleaseGroup | undefined;
  let continuation = false;
  const currentGroup = () => {
    if (!group) {
      group = { title: "", items: [], notes: [] };
      release!.groups.push(group);
    }
    return group;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/.exec(line);
    if (heading) {
      release = { version: heading[1]!, date: heading[2] || "", note: heading[3] || "", groups: [] };
      releases.push(release);
      group = undefined;
      continuation = false;
      continue;
    }
    if (!release || /^\s*\[[^\]]+\]:\s/.test(line)) continue;
    const title = /^###\s+(.+)$/.exec(line);
    if (title) {
      group = { title: title[1]!, items: [], notes: [] };
      release.groups.push(group);
      continuation = false;
      continue;
    }
    const item = /^-\s+(.+)$/.exec(line);
    if (item) {
      currentGroup().items.push(item[1]!);
      continuation = true;
    } else if (continuation && /^\s+\S/.test(line)) {
      const items = currentGroup().items;
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      continuation = false;
      if (line.trim()) currentGroup().notes.push(line.trim());
    }
  }
  return releases;
}
