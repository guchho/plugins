// Integration tests against a real Guchho build.
//
// The banner plugin is a hook plugin: guchho runs it in the host process while
// a build runs, so these tests need a guchho whose build() hosts plugins. The
// published guchho may not have that host yet, so the suite resolves the engine
// deliberately:
//
//   1. GUCHHO_PACKAGE  — a path to a guchho package (a checkout of the repo, or
//                        an installed one), used as-is.
//   2. a sibling       — ../.. up to the monorepo root, then guchho/. Chosen so
//                        importing a local repo checkout is automatic.
//   3. import("guchho")— whatever is installed.
//
// Whatever engine is resolved, the suite probes it for plugin support with a
// no-op buildStart and skips with an explanation when it answers no.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import banner from "../src/index.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-banner-integration-"));
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
  const plugin = {
    name: "@guchho/banner-probe",
    buildStart() {
      sawStart = true;
    },
  };
  try {
    await guchho.build({
      stdin: { contents: "console.log(1);", loader: "js" },
      write: false,
      plugins: [plugin],
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

test("build prepends the plugin banner to JS and CSS outputs", { skip }, async () => {
  const dir = makeProject({
    "package.json": JSON.stringify({ name: "demo-app", version: "1.0.0", author: "Hemanta Gayen", license: "MIT" }),
    "src/index.js": "export const value = 42;",
    "src/styles.css": "body{color:red}",
  });
  try {
    const result = await guchho.build({
      absWorkingDir: dir,
      entrypoints: ["src/index.js", "src/styles.css"],
      outdir: "dist",
      bundle: true,
      write: false,
      plugins: [banner({ packageJson: path.join(dir, "package.json"), year: 2026 })],
    });

    assert.ok(
      !result.errors.length,
      `build failed: ${result.errors.map((e) => e.text).join("\n")}`,
    );

    const js = textOf(result, "dist/index.js");
    assert.ok(js.startsWith("/*!"), "the JS output should start with the banner");
    assert.ok(js.includes("demo-app v1.0.0"));
    assert.ok(js.includes("Copyright (c) 2026 Hemanta Gayen"));
    assert.ok(js.includes("Released under the MIT License"));
    assert.ok(js.includes("value = 42"));

    const css = textOf(result, "dist/styles.css");
    assert.ok(css.startsWith("/*!"), "the CSS output should start with the banner");
    assert.ok(css.includes("demo-app v1.0.0"));
    assert.ok(css.includes("color: red"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a source map is left untouched while the JS output is bannered", { skip }, async () => {
  const dir = makeProject({
    "package.json": JSON.stringify({ name: "demo-app", version: "1.0.0" }),
    "src/index.js": "export const value = 42;",
  });
  try {
    const result = await guchho.build({
      absWorkingDir: dir,
      entrypoints: ["src/index.js"],
      outdir: "dist",
      bundle: true,
      sourcemap: true,
      write: false,
      plugins: [banner({ packageJson: path.join(dir, "package.json"), year: 2026 })],
    });

    assert.ok(!result.errors.length, result.errors.map((e) => e.text).join("\n"));
    const js = textOf(result, "dist/index.js");
    assert.ok(js.startsWith("/*!"), "the JS output should start with the banner");

    const jsMap = textOf(result, "dist/index.js.map");
    assert.ok(jsMap !== undefined, "a source map should have been produced");
    assert.ok(jsMap.startsWith("{"), "the source map should remain JSON");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preserveExisting keeps a file that already carries a legal banner", { skip }, async () => {
  const dir = makeProject({
    "package.json": JSON.stringify({ name: "demo-app", version: "1.0.0" }),
    "src/index.js": "/*! already here */\nconsole.log(1);",
  });
  try {
    const result = await guchho.build({
      absWorkingDir: dir,
      entrypoints: ["src/index.js"],
      outdir: "dist",
      write: false,
      plugins: [banner({ packageJson: path.join(dir, "package.json"), year: 2026, preserveExisting: true })],
    });

    assert.ok(!result.errors.length, result.errors.map((e) => e.text).join("\n"));
    const js = textOf(result, "dist/index.js");
    assert.ok(js.startsWith("/*! already here */"), "the existing banner should be preserved");
    assert.ok(!js.includes("demo-app"), "the plugin should not have injected its own");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing package.json fails the build with the plugin's message", { skip }, async () => {
  const dir = makeProject({ "src/index.js": "console.log(1);" });
  try {
    await assert.rejects(
      () =>
        guchho.build({
          absWorkingDir: dir,
          entrypoints: ["src/index.js"],
          outdir: "dist",
          write: false,
          plugins: [banner({ packageJson: path.join(dir, "missing.json") })],
        }),
      (error) =>
        String(error.message).includes("cannot read package metadata") &&
        String(error.message).includes("@guchho/banner"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});