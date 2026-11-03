import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseChangelog } from "../src/domain/changelog.ts";

test("release notes: the package version has a dated entry, with drafts kept separate", async () => {
  const [{ version }, markdown] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ]);
  const releases = parseChangelog(markdown);
  assert.equal(new Set(releases.map(release => release.version)).size, releases.length);
  const current = releases.find(release => release.version === version);
  assert.match(current?.date || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(current.groups.some(group => group.items.length));
  const draft = releases.find(release => release.version === "未发布");
  if (draft) assert.equal(draft.date, "");
  assert.equal(releases.some(release => release.groups.some(group => group.notes.some(note => /^\[[^\]]+\]:/.test(note)))), false);
});

test("release notes: retain withdrawal notes, grouped items and limitations while skipping reference definitions", () => {
  const releases = parseChangelog([
    "# 更新日志", "面向使用者的说明。", "", "## [未发布]", "- 草稿内容", "",
    "## [1.2.0] - 2026-11-03（功能已撤回）", "", "### 新增", "- 一个变化", "  同一条的补充", "",
    "### 修复", "- 一个修复", "", "此版本有使用限制。", "", "[1.2.0]: https://example.test/releases/1.2.0",
  ].join("\r\n"));
  assert.equal(releases.length, 2);
  assert.equal(releases[0].version, "未发布");
  assert.equal(releases[1].note, "（功能已撤回）");
  assert.deepEqual(releases[1].groups, [
    { title: "新增", items: ["一个变化 同一条的补充"], notes: [] },
    { title: "修复", items: ["一个修复"], notes: ["此版本有使用限制。"] },
  ]);
});
