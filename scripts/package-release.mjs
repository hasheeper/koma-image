import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function files(directory, prefix = "", allowTemplate = false) {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix + entry.name;
    if (
      entry.isSymbolicLink() ||
      (entry.name.startsWith(".") &&
        !(allowTemplate && name === ".env.example"))
    )
      throw new Error(`发布文件无效：${name}`);
    if (entry.isDirectory())
      result.push(...(await files(directory, name + "/", allowTemplate)));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`发布文件无效：${name}`);
  }
  return result.sort();
}

/** Explicit delivery allowlist; never copy the checkout, environment or local application data. */
export async function packageRelease(output = join(root, ".local/releases")) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version))
    throw new Error("发布版本无效");
  const name = `koma-image-${pkg.version}`;
  const temporary = await mkdtemp(join(tmpdir(), "koma-release-"));
  const stage = join(temporary, name);
  const runtimeFiles = [
    "server.mjs",
    "src/config/connections.ts",
    "src/gateway/profile.ts",
    "src/gateway/transport.ts",
    "src/domain/value.ts",
    "docs/third-party-assets.md",
  ];
  try {
    await mkdir(stage);
    await readFile(join(root, "dist/index.html"));
    // Validate before copying, so symlinks and accidental private files fail closed.
    for (const file of await files(join(root, "dist"))) {
      if (
        !/\.(?:html|js|css|svg|woff2|png|json|txt)$/.test(file) &&
        !/(?:^|\/)[\w-]*LICENSE$/.test(file)
      )
        throw new Error(`构建产物包含未审查文件：${file}`);
    }
    await cp(join(root, "dist"), join(stage, "dist"), { recursive: true });
    for (const file of runtimeFiles) {
      if (!(await lstat(join(root, file))).isFile())
        throw new Error(`发布文件无效：${file}`);
      await mkdir(dirname(join(stage, file)), { recursive: true });
      await cp(join(root, file), join(stage, file));
    }
    // Generate a blank template instead of copying any locally edited environment file.
    await writeFile(
      join(stage, ".env.example"),
      "KOMA_GATEWAY_URL=\nKOMA_GATEWAY_KEY=\nKOMA_ASK_OPENAI_URL=\nKOMA_ASK_OPENAI_KEY=\nKOMA_ASK_ANTHROPIC_URL=\nKOMA_ASK_ANTHROPIC_KEY=\nKOMA_PORT=3218\nKOMA_BASE_PATH=/\n",
    );
    await cp(join(root, "docs/release-guide.md"), join(stage, "README.md"));
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          private: true,
          type: "module",
          license: pkg.license,
          engines: pkg.engines,
          scripts: { start: pkg.scripts.start },
        },
        null,
        2,
      ) + "\n",
    );
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    await writeFile(
      join(stage, "release.json"),
      JSON.stringify(
        {
          app: pkg.name,
          version: pkg.version,
          commit: git("rev-parse", "HEAD"),
          sourceDirty: Boolean(git("status", "--porcelain")),
          node: process.version,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    // The only permitted dotfile is the generated, empty environment template.
    const regular = await files(stage, "", true);
    const lines = await Promise.all(
      regular.map(
        async (file) =>
          `${checksum(await readFile(join(stage, file)))}  ${file}`,
      ),
    );
    await writeFile(join(stage, "SHA256SUMS"), lines.join("\n") + "\n");
    await mkdir(output, { recursive: true });
    const archive = resolve(output, name + ".tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", temporary, name], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    await writeFile(
      archive + ".sha256",
      `${checksum(await readFile(archive))}  ${name}.tar.gz\n`,
    );
    return archive;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(await packageRelease());
