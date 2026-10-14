// Integration tests against a real Guchho build.
//
// The declaration bundler is a hook plugin, so these tests need a guchho whose
// build hosts plugin hooks. The published guchho may not have the host yet, so
// the engine is resolved deliberately:
//
//   1. GUCHHO_PACKAGE  — a path to a guchho package, used as-is.
//   2. a sibling       — up to the monorepo root, then guchho/.
//   3. import("guchho")— whatever is installed.
//
// Whatever engine is resolved, the suite probes it with a no-op buildStart and
// skips with an explanation when it answers no.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import dts from "../src/index.js";

function resolveEngineUrl() {
  const override = process.env.GUCHHO_PACKAGE;
  if (override) {
    const absolute = path.resolve(override);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      return pathToFileURL(path.join(absolute, "lib", "index.mjs")).href;
    }
    return pathToFileURL(absolute).href;
  }

  const sibling = new URL("../../../guchho/package/npm/guchho/lib/index.mjs", import.meta.url);
  if (fs.existsSync(sibling)) return sibling.href;

  return "guchho";
}

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-dts-integration-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

function textOf(result, ending) {
  const normalized = ending.replace(/\\/g, "/");
  const file = result.outputFiles.find((f) => f.path.replace(/\\/g, "/").endsWith(normalized));
  return file === undefined ? undefined : file.text;
}

async function probePlugins(guchho) {
  let sawStart = false;
  try {
    await guchho.build({
      stdin: { contents: "console.log(1);", loader: "js" },
      write: false,
      plugins: [
        {
          name: "@guchho/dts-probe",
          buildStart() {
            sawStart = true;
          },
        },
      ],
    });
  } catch {
    return false;
  }
  return sawStart;
}

const guchho = await import(resolveEngineUrl());
const supportsPlugins = await probePlugins(guchho);
const skip = supportsPlugins
  ? false
  : "this guchho does not host plugin hooks; set GUCHHO_PACKAGE (and a matching GUCHHO_BINARY) or use a newer guchho";

test("build emits a bundled declaration alongside the JavaScript output", { skip }, async () => {
  const dir = makeProject({
    "src/index.js": "export const value = 42;",
    "src/index.d.ts": 'export { Foo } from "./foo";\nexport declare const value: number;\n',
    "src/foo.d.ts": "export interface Foo { a: string }\n",
  });
  try {
    const result = await guchho.build({
      absWorkingDir: dir,
      entrypoints: ["src/index.js"],
      outdir: "dist",
      bundle: true,
      write: false,
      plugins: [
        dts({
          entry: path.join(dir, "src", "index.d.ts"),
          outfile: path.join(dir, "dist", "index.d.ts"),
        }),
      ],
    });

    assert.ok(
      !result.errors.length,
      `build failed: ${result.errors.map((e) => e.text).join("\n")}`,
    );

    assert.ok(textOf(result, "dist/index.js") !== undefined, "the JS output should be written");

    const declaration = textOf(result, "dist/index.d.ts");
    assert.ok(declaration !== undefined, "a declaration bundle should have been emitted");
    assert.match(declaration, /interface Foo \{/);
    assert.match(declaration, /export \{ Foo, value \};/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a declaration error fails the build with the plugin's message", { skip }, async () => {
  const dir = makeProject({
    "src/index.js": "export const value = 42;",
    "src/index.d.ts": "export declare const broken: NotAType;\n",
  });
  try {
    await assert.rejects(
      () =>
        guchho.build({
          absWorkingDir: dir,
          entrypoints: ["src/index.js"],
          outdir: "dist",
          write: false,
          plugins: [
            dts({
              entry: path.join(dir, "src", "index.d.ts"),
              outfile: path.join(dir, "dist", "index.d.ts"),
            }),
          ],
        }),
      (error) => /error TS\d+/.test(String(error.message)),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
