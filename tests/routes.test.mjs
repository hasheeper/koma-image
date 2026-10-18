import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../src/app/routes.ts";

test("safe default and neutral workspace links", () => {
  for (const value of ["", "#", "#/unknown", "#/%E0%A4%A"]) {
    assert.equal(parseRoute(value).workspace, "image");
  }
  assert.equal(parseRoute("#chat").workspace, "chat");
  assert.equal(parseRoute("#/tags?q=blue").workspace, "tags");
});
test("overlay URLs preserve the workspace identity", () => {
  for (const workspace of ["image", "chat", "tags"]) {
    for (const overlay of [null, "editor", "settings"]) {
      const route = { workspace, overlay, section: "backup" };
      const parsed = parseRoute(routeHash(route));
      assert.equal(parsed.workspace, workspace);
      assert.equal(parsed.overlay, overlay);
      if (overlay === "settings") assert.equal(parsed.section, "backup");
    }
  }
  assert.equal(parseRoute("#/chat/settings/unknown").section, "connections");
  assert.equal(parseRoute("#/image/unknown").overlay, null);
});
