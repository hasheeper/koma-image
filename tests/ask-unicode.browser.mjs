import { test } from "node:test";
import assert from "node:assert/strict";
import { useAskFixture, open, askSettings, bind, route, cp2Send, openai, text, end, generation } from "./helpers/ask-fixture.mjs";

useAskFixture();

test("ASK Unicode word encoding: settings control the outgoing request and restored reply", async () => {
  const { page, context, llm, calls, requests, errors } = await open("/#/image/settings/ask", { ask: askSettings() });
  try {
    await page.locator('label[for="askAdult"]').click();
    await page.locator('label[for="askAlwaysCodec"]').click();
    const group = page.getByRole("radiogroup", { name: "词条编码" });
    await group.getByText("Unicode", { exact: true }).click();
    await page.getByRole("textbox", { name: "添加词条" }).fill("柔光");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.waitForFunction(() => {
      const settings = JSON.parse(localStorage.getItem("koma.ask.v1"));
      return settings.wordEncoding === "unicode" && settings.alwaysCodec && settings.words.includes("柔光");
    });
    await route(page, "#/image");
    await bind(page);
    await page.evaluate(() => ask.show());
    llm.push({ body: openai(text("已经加上\\u67d4"), text("\\u5149。"), end()) });
    await cp2Send(page, "请增加柔光");
    assert.ok(calls[0].body.messages.at(-1).content.endsWith("请增加\\u67d4\\u5149"));
    assert.match(await page.locator(".ask-turn").innerText(), /已经加上柔光/);
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
