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
