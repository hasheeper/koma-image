import test from "node:test";
import assert from "node:assert/strict";
import { connectionIcon } from "../src/domain/connection-icon.ts";

test("connection icons: fixed official NovelAI and neutral image/LLM defaults", () => {
  assert.deepEqual(connectionIcon(), { icon: "i-swap", label: "连接" });
  assert.deepEqual(connectionIcon({ profileId: "nai-official-v1", baseUrl: "https://image.novelai.net" }), { family: "novelai", label: "NovelAI 官方" });
  for (const profileId of ["koma-standard-v1", "openai-images-v1", "gemini-native-v1"])
    assert.deepEqual(connectionIcon({ profileId, baseUrl: "https://gateway.example.test" }), { icon: "i-image", label: "生图连接" });
  for (const profileId of ["openai-chat-v1", "anthropic-messages-v1"])
    assert.deepEqual(connectionIcon({ profileId, baseUrl: "https://gateway.example.test" }), { icon: "i-chat", label: "文本连接" });
});

test("connection icons: Google AIS/Vertex and OpenAI/Azure official endpoints share provider logos across capabilities", () => {
  for (const [family, urls] of [
    ["gemini", ["https://generativelanguage.googleapis.com/v1beta/openai", "https://aiplatform.googleapis.com/v1", "https://us-central1-aiplatform.googleapis.com/v1/projects/sample/locations/us-central1/endpoints/openapi", "https://123.us-central1-456.prediction.vertexai.goog/v1"]],
    ["openai", ["https://api.openai.com/v1", "https://API.OPENAI.COM:443/v1", "https://sample.openai.azure.com/openai/v1", "https://sample.services.ai.azure.com/openai/v1"]],
  ]) for (const profileId of ["openai-chat-v1", "openai-images-v1", "gemini-native-v1"])
    for (const baseUrl of urls) {
      const connection = Object.freeze({ profileId, baseUrl });
      assert.equal(connectionIcon(connection).family, family, baseUrl);
      assert.equal(connection.profileId, profileId);
    }
});

test("connection icons: names, proxy paths, lookalike hosts and unrelated cloud services cannot claim official logos", () => {
  for (const baseUrl of [
    "", "invalid", "http://api.openai.com", "https://api.openai.com:8443", "https://proxy.example.test/openai/v1",
    "https://api.openai.com.example.test", "https://api.openai.com@proxy.example.test", "https://user@api.openai.com",
    "https://proxy.example.test?target=https://api.openai.com", "https://evilopenai.azure.com", "https://sample.openai.azure.com.example.test",
    "https://generativelanguage.googleapis.com.example.test", "https://us-central1-aiplatform.googleapis.com.example.test",
    "https://fonts.googleapis.com", "https://project.run.app", "https://prediction.vertexai.goog.example.test",
    "https://sample.services.ai.azure.com/models", "https://sample.services.ai.azure.com/openai-lookalike", "https://sample.inference.ai.azure.com",
  ]) assert.deepEqual(connectionIcon({ profileId: "openai-chat-v1", baseUrl, name: "Google OpenAI 官方" }), { icon: "i-chat", label: "文本连接" }, baseUrl);
});
