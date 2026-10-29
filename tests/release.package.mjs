import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageRelease } from "../scripts/package-release.mjs";

test("M7 release: allowlisted archive, checksums, dependency-free extracted server, root/subpath and runtime injection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "koma-package-test-"));
  try {
    const archive = await packageRelease(directory);
    const digest = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    assert.ok((await readFile(archive + ".sha256", "utf8")).startsWith(digest));
    execFileSync("tar", ["-xzf", archive, "-C", directory]);
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const root = join(directory, `koma-image-${pkg.version}`);
    const license = await readFile("LICENSE", "utf8");
    assert.equal(await readFile(join(root, "LICENSE"), "utf8"), license);
    assert.equal(await readFile(join(root, "dist/LICENSE"), "utf8"), license);
    const entries = (await readFile(join(root, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n");
    for (const entry of entries) {
      const [hash, file] = entry.split("  ");
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(root, file)))
          .digest("hex"),
        hash,
        file,
      );
      assert.equal(
        /(?:^|\/)(?:\.git|\.local|node_modules|tests)(?:\/|$)|(?:^|\/)\.env$/.test(
          file,
        ),
        false,
        file,
      );
    }
    assert.match(
      await readFile(join(root, ".env.example"), "utf8"),
      /^KOMA_GATEWAY_URL=\nKOMA_GATEWAY_KEY=\n/,
    );
    for (const protocol of ["OPENAI", "ANTHROPIC"])
      for (const field of ["URL", "KEY"])
        assert.match(await readFile(join(root, ".env.example"), "utf8"), new RegExp(`^KOMA_ASK_${protocol}_${field}=$`, "m"));
    assert.equal(
      JSON.parse(await readFile(join(root, "package.json"), "utf8"))
        .dependencies,
      undefined,
    );
    const { createLocalServer } = await import(
      pathToFileURL(join(root, "server.mjs")).href
    );
    for (const mount of ["/", "/app/"]) {
      let seen = 0;
      const local = createLocalServer({
        env: {
          KOMA_BASE_PATH: mount,
          ...(mount === "/app/"
            ? {
                KOMA_GATEWAY_URL: "https://gateway.example.test",
                KOMA_GATEWAY_KEY: "synthetic-package-secret",
              }
            : {}),
        },
        fetcher: async (_url, init) => {
          seen++;
          assert.equal(
            init.headers.Authorization,
            "Bearer synthetic-package-secret",
          );
          return Response.json({
            studio_features: { version: 2, max_cost: true },
          });
        },
      });
      await new Promise((resolve) => local.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${local.address().port}`;
      try {
        const html = await (await fetch(origin + mount)).text();
        assert.match(html, /Koma Image/);
        const script = html.match(/src="([^"]+\.js)"/)[1];
        assert.equal(
          (await fetch(new URL(script, origin + mount))).status,
          200,
        );
        assert.equal(html.includes("synthetic-package-secret"), false);
        assert.equal(html.includes("gateway.example.test"), false);
        assert.equal((await fetch(origin + mount + ".env")).status, 404);
        const skill = await fetch(origin + mount + "skills/koma-bridge/SKILL.md");
        assert.equal(skill.status, 200);
        assert.match(skill.headers.get("content-type"), /^text\/plain;\s*charset=utf-8$/i);
        assert.equal(
          await skill.text(),
          await readFile("public/skills/koma-bridge/SKILL.md", "utf8"),
          "public skill is readable without runtime injection or an upstream request",
        );
        assert.equal(seen, 0);
        if (mount === "/app/") {
          const token = JSON.parse(
            html.match(/id="koma-runtime"[^>]*>(.*?)<\/script>/)[1],
          ).token;
          assert.equal(
            (
              await fetch(origin + mount + "api/v1/image/models", {
                headers: { "X-Koma-Local-Token": token },
              })
            ).status,
            200,
          );
          assert.equal(seen, 1);
        } else assert.equal(html.includes("koma-runtime"), false);
      } finally {
        local.closeAllConnections();
        await new Promise((resolve) => local.close(resolve));
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
