// Use the build() API from the installed Guchho npm package for integration testing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, stop, ServiceError } from "guchho";
import banner from "../src/index.js";

test("build prepends the plugin banner to the JS output", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-banner-integration-"));
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "demo-app", version: "1.0.0", author: "Hemanta Gayen", license: "MIT" }),
    );
    fs.writeFileSync(path.join(dir, "src", "index.js"), "export const value = 42;");

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const descriptor = banner({ year: 2026 });
      try {
        await build({
          entrypoints: ["src/index.js"],
          outdir: "dist",
          banner: descriptor.banner.js,
          write: true,
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          t.skip(`guchho engine unavailable: ${error.message}`);
          return;
        }
        throw error;
      }
    } finally {
      process.chdir(previous);
    }

    const output = fs.readFileSync(path.join(dir, "dist", "index.js"), "utf8");
    assert.ok(output.startsWith("/*!"));
    assert.ok(output.includes("demo-app v1.0.0"));
    assert.ok(output.includes("Copyright (c) 2026 Hemanta Gayen"));
    assert.ok(output.includes("Released under the MIT License"));
    assert.ok(output.includes("export const value = 42;"));
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const RICH_PACKAGE = JSON.stringify(
  {
    name: "my-library",
    version: "1.0.0",
    description: "A useful JavaScript library",
    author: "Your Name",
    license: "MIT",
    homepage: "https://example.com",
    repository: { type: "git", url: "https://github.com/example/my-library" },
  },
  null,
  2,
);

function withProject(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-banner-integration-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return fn(dir);
  } finally {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("minimal style descriptor contains only name and version", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    const descriptor = banner({ style: "minimal", year: 2026 });
    assert.equal(descriptor.banner.js, "/*! my-library v1.0.0 */");
  });
});

test("full style descriptor includes all metadata fields", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    const text = banner({ style: "full", year: 2026 }).banner.js;
    assert.ok(text.includes("Package: my-library"));
    assert.ok(text.includes("Version: 1.0.0"));
    assert.ok(text.includes("Description: A useful JavaScript library"));
    assert.ok(text.includes("Author: Your Name"));
    assert.ok(text.includes("License: MIT"));
    assert.ok(text.includes("Homepage: https://example.com"));
    assert.ok(text.includes("Repository: https://github.com/example/my-library"));
  });
});

test("none style descriptor has empty banner text", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    const descriptor = banner({ style: "none", year: 2026 });
    assert.equal(descriptor.banner.js, "");
    assert.equal(descriptor.banner.css, "");
  });
});

test("preserveExisting flag is exposed on the descriptor", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    assert.equal(banner({ year: 2026 }).preserveExisting, false);
    assert.equal(banner({ year: 2026, preserveExisting: true }).preserveExisting, true);
  });
});

test("date string option produces a deterministic banner", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    const a = banner({ year: 2026, date: "2026-10-11" }).banner.js;
    const b = banner({ year: 2026, date: "2026-10-11" }).banner.js;
    assert.equal(a, b);
    assert.ok(a.includes("Built 2026-10-11"));
  });
});

test("all styles produce identical js and css text on the descriptor", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    const styles = [
      "minimal", "short", "compact", "standard", "long",
      "production", "full", "legal", "license", "author",
      "version", "dated", "boxed", "separated", "none",
    ];
    for (const style of styles) {
      const descriptor = banner({ style, year: 2026 });
      assert.equal(descriptor.banner.js, descriptor.banner.css, `${style} js/css mismatch`);
    }
  });
});
