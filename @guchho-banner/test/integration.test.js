import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUCHHO_BUILD = fileURLToPath(
  new URL("../../guchho/build/release-win32-x64-ninja/bin/guchho.exe", import.meta.url),
);
const GUCHHO_STOCK = fileURLToPath(new URL("../testing/guchho.exe", import.meta.url));

const FIXTURE = {
  name: "acme-widget",
  version: "3.1.4",
  author: "Acme Corp",
  license: "MIT",
};

const LONG_BANNER = [
  "/*!",
  " * acme-widget v3.1.4",
  " * Copyright (c) 2026 Acme Corp",
  " *",
  " * Released under the MIT License",
  " */",
].join("\n");

const SHORT_BANNER =
  "/*! acme-widget v3.1.4 | Copyright (c) 2026 Acme Corp | MIT License */";

const SOURCE_JS = 'export const answer = 42;\nconsole.log(answer);\n';
const SOURCE_CSS = "body {\n  color: red;\n}\n";

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeSegment(token) {
  const values = [];
  let i = 0;
  while (i < token.length) {
    let shift = 0;
    let value = 0;
    let byte;
    do {
      byte = B64.indexOf(token[i++]);
      assert.notEqual(byte, -1, `invalid base64 VLQ char in ${JSON.stringify(token)}`);
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte & 32);
    const negative = value & 1;
    value >>>= 1;
    values.push(negative ? -value : value);
  }
  return values;
}

// Returns decoded mappings grouped by generated line index (0-based), with
// source indices/lines/columns carried across lines as the format requires.
function decodeMappings(mappings) {
  const lines = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  for (const lineText of mappings.split(";")) {
    const segments = [];
    let genCol = 0;
    for (const token of lineText.split(",")) {
      if (!token) continue;
      const values = decodeSegment(token);
      genCol += values[0];
      const segment = { genCol };
      if (values.length >= 4) {
        srcIdx += values[1];
        srcLine += values[2];
        srcCol += values[3];
        segment.srcIdx = srcIdx;
        segment.srcLine = srcLine;
        segment.srcCol = srcCol;
      }
      segments.push(segment);
    }
    lines.push(segments);
  }
  return lines;
}

function runGuchho(binary, cwd, extraArgs = []) {
  return spawnSync(binary, ["build", ...extraArgs], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}

function makeProject({ files, config, packageJson = FIXTURE }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-banner-it-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson, null, 2));
  fs.writeFileSync(path.join(dir, "guchho.config.js"), config);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  // A consumer installs the package by name; copy it in so the config's
  // `import banner from "@guchho/banner"` resolves exactly as in a project.
  const dest = path.join(dir, "node_modules", "@guchho", "banner");
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, "package.json"), path.join(dest, "package.json"));
  fs.cpSync(path.join(PKG_ROOT, "src"), path.join(dest, "src"), { recursive: true });
  return dir;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function withBuild(binary, configure, fn) {
  const dir = makeProject(configure);
  try {
    const result = runGuchho(binary, dir, configure.args ?? []);
    const api = {
      dir,
      result,
      ok: result.status === 0,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8"),
      readBinary: (rel) => fs.readFileSync(path.join(dir, rel)),
      files: () => walk(dir).filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`)),
      find: (suffix) => walk(dir).filter((f) => f.endsWith(suffix)),
    };
    return fn(api);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function assertBuildOk(api) {
  assert.equal(
    api.ok,
    true,
    `guchho build failed (status ${api.result.status}):\n${api.output}`,
  );
}

// ---- capability detection -------------------------------------------------

// An explicit GUCHHO_BIN is authoritative: if it lacks plugin banner
// support, the suite skips rather than silently testing a different build.
const candidates = process.env.GUCHHO_BIN
  ? [process.env.GUCHHO_BIN]
  : [GUCHHO_BUILD, GUCHHO_STOCK].filter(Boolean);

function probe(binary) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-banner-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "main.js"), "export const probe = 1;\n");
    fs.writeFileSync(
      path.join(dir, "guchho.config.js"),
      `export default {
  build: { entry: "main.js", outdir: "dist" },
  plugins: [{ name: "probe", banner: { js: "/*! PROBE_MARKER */", css: "/*! PROBE_MARKER */" } }],
};
`,
    );
    const result = runGuchho(binary, dir);
    if (result.status !== 0) return false;
    const out = path.join(dir, "dist", "main.js");
    if (!fs.existsSync(out)) return false;
    return fs.readFileSync(out, "utf8").includes("/*! PROBE_MARKER */");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let binary = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate) && probe(candidate)) {
    binary = candidate;
    break;
  }
}

const SKIP = binary
  ? false
  : `no Guchho binary with plugin banner support found (tried: ${candidates.join(", ")}); ` +
    "set GUCHHO_BIN to a descriptor-capable build";

const config = (body) =>
  `import banner from "@guchho/banner";\n\nexport default ${body};\n`;

const plugin = 'banner({ year: 2026 })';

// ---- JavaScript integration ------------------------------------------------

test("JS: ESM output starts with the long banner", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${LONG_BANNER}\n`), `output was:\n${js}`);
      assert.ok(js.includes("const answer = 42;"), `output was:\n${js}`);
    },
  );
});

test("JS: banner survives minification", { skip: SKIP }, () => {
  const build = (minify) =>
    withBuild(
      binary,
      {
        files: { "main.js": SOURCE_JS },
        config: config(
          `{ build: { entry: "main.js", outdir: "dist", format: "esm", minify: ${minify} }, plugins: [${plugin}] }`,
        ),
      },
      (api) => {
        assertBuildOk(api);
        return api.read("dist/main.js");
      },
    );
  const unminified = build(false);
  const minified = build(true);
  assert.ok(minified.startsWith(`${LONG_BANNER}\n`), `output was:\n${minified}`);
  assert.ok(minified.length < unminified.length, "minified output should be smaller");
  assert.ok(count(minified, "Copyright (c) 2026 Acme Corp") === 1);
});

test("JS: CJS output carries the banner", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "cjs" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${LONG_BANNER}\n`));
      assert.ok(js.includes("module.exports") || js.includes("exports."));
    },
  );
});

test("JS: IIFE output carries the banner", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "iife", name: "Acme" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${LONG_BANNER}\n`));
    },
  );
});

test("JS: minified UMD output carries the banner", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "umd", name: "Acme", minify: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${LONG_BANNER}\n`));
      assert.equal(count(js, "Released under the MIT License"), 1);
    },
  );
});

test("JS: short style survives minification", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm", minify: true }, plugins: [banner({ year: 2026, style: "short" })] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${SHORT_BANNER}\n`), `output was:\n${js}`);
    },
  );
});

test("JS: the banner appears exactly once", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm", minify: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.equal(count(js, "acme-widget v3.1.4"), 1);
      assert.equal(count(js, "Copyright (c) 2026 Acme Corp"), 1);
    },
  );
});

test("JS: built-in banner and plugin banner coexist", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm", banner: { js: "/*! BUILTIN */" } }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      const builtin = js.indexOf("/*! BUILTIN */");
      const pluginPos = js.indexOf(LONG_BANNER);
      assert.ok(builtin !== -1, "built-in banner missing");
      assert.ok(pluginPos !== -1, "plugin banner missing");
      assert.ok(builtin < pluginPos, "built-in banner should come first");
      assert.equal(count(js, "Copyright (c) 2026 Acme Corp"), 1);
    },
  );
});

test("JS: source map mappings account for the banner", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm", sourcemap: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${LONG_BANNER}\n`));
      assert.ok(js.includes("sourceMappingURL=main.js.map"));

      const map = JSON.parse(api.read("dist/main.js.map"));
      assert.equal(map.version, 3);
      assert.ok(Array.isArray(map.sources) && map.sources.length > 0);
      assert.ok(Array.isArray(map.sourcesContent) && map.sourcesContent[0].includes("export const answer"));

      const bannerLines = LONG_BANNER.split("\n").length;
      const lines = decodeMappings(map.mappings);
      const firstCodeSegment = lines[bannerLines]?.[0];
      assert.ok(firstCodeSegment, "no mapping on the first line after the banner");
      assert.equal(firstCodeSegment.srcLine, 0, "first code line should map to original line 0");
      assert.equal(firstCodeSegment.srcIdx, 0, "first code line should map to the first source");
    },
  );
});

test("JS: the source map file itself is never bannered", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm", sourcemap: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const raw = api.read("dist/main.js.map");
      assert.ok(!raw.includes("Copyright"), "map file must not contain the banner");
      JSON.parse(raw);
    },
  );
});

test("JS: directive prologues are unaffected by the banner", { skip: SKIP }, () => {
  const entry = '"use strict";\nvar strictValue = 1;\nmodule.exports = strictValue;\n';
  const build = (withBanner) =>
    withBuild(
      binary,
      {
        files: { "main.js": entry },
        config: config(
          withBanner
            ? `{ build: { entry: "main.js", outdir: "dist", format: "cjs" }, plugins: [${plugin}] }`
            : `{ build: { entry: "main.js", outdir: "dist", format: "cjs" } }`,
        ),
      },
      (api) => {
        assertBuildOk(api);
        return api.read("dist/main.js");
      },
    );
  const control = build(false);
  const bannered = build(true);
  assert.ok(bannered.startsWith(`${LONG_BANNER}\n`));
  assert.equal(
    count(bannered, '"use strict"'),
    count(control, '"use strict"'),
    `banner changed the directive prologue:\ncontrol:\n${control}\nbannered:\n${bannered}`,
  );
});

// ---- CSS integration -------------------------------------------------------

test("CSS: unminified output starts with the banner and keeps rules", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "style.css": SOURCE_CSS },
      config: config(
        `{ build: { entry: "style.css", outdir: "dist", minify: false }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const css = api.read("dist/style.css");
      assert.ok(css.startsWith(`${LONG_BANNER}\n`), `output was:\n${css}`);
      assert.ok(css.includes("body"));
      assert.ok(css.includes("color"));
      assert.ok(css.includes("red"));
    },
  );
});

test("CSS: banner survives minification", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "style.css": SOURCE_CSS },
      config: config(
        `{ build: { entry: "style.css", outdir: "dist", minify: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const css = api.read("dist/style.css");
      assert.ok(css.startsWith(`${LONG_BANNER}\n`), `output was:\n${css}`);
      const body = css.slice(LONG_BANNER.length);
      assert.ok(!/body \{\n/.test(body), "minified css should not keep pretty-printed blocks");
      assert.equal(count(css, "Copyright (c) 2026 Acme Corp"), 1);
    },
  );
});

test("CSS: short style works", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "style.css": SOURCE_CSS },
      config: config(
        `{ build: { entry: "style.css", outdir: "dist", minify: true }, plugins: [banner({ year: 2026, style: "short" })] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const css = api.read("dist/style.css");
      assert.ok(css.startsWith(`${SHORT_BANNER}\n`), `output was:\n${css}`);
    },
  );
});

test("CSS: source map mappings account for the banner", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "style.css": SOURCE_CSS },
      config: config(
        `{ build: { entry: "style.css", outdir: "dist", sourcemap: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const css = api.read("dist/style.css");
      assert.ok(css.startsWith(`${LONG_BANNER}\n`));

      const map = JSON.parse(api.read("dist/style.css.map"));
      assert.equal(map.version, 3);
      assert.ok(map.sourcesContent?.[0]?.includes("body"));

      const bannerLines = LONG_BANNER.split("\n").length;
      const lines = decodeMappings(map.mappings);
      const firstRule = lines[bannerLines]?.[0];
      assert.ok(firstRule, "no mapping on the first line after the banner");
      assert.equal(firstRule.srcLine, 0, "first rule should map to original line 0");
    },
  );
});

test("CSS: built-in banner and plugin banner coexist", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "style.css": SOURCE_CSS },
      config: config(
        `{ build: { entry: "style.css", outdir: "dist", banner: { css: "/*! BUILTIN_CSS */" } }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const css = api.read("dist/style.css");
      const builtin = css.indexOf("/*! BUILTIN_CSS */");
      const pluginPos = css.indexOf(LONG_BANNER);
      assert.ok(builtin !== -1 && pluginPos !== -1, "both banners should be present");
      assert.ok(builtin < pluginPos, "built-in banner should come first");
    },
  );
});

// ---- combined and multi-output builds --------------------------------------

test("one build banners both JavaScript and CSS entries", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS, "style.css": SOURCE_CSS },
      config: config(
        `{ build: { entry: ["main.js", "style.css"], outdir: "dist" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      assert.ok(api.read("dist/main.js").startsWith(`${LONG_BANNER}\n`));
      assert.ok(api.read("dist/style.css").startsWith(`${LONG_BANNER}\n`));
    },
  );
});

test("every build of a config array is bannered", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `[
  { build: { entry: "main.js", outfile: "dist/a.esm.js", format: "esm" }, plugins: [${plugin}] },
  { build: { entry: "main.js", outfile: "dist/b.cjs.js", format: "cjs" }, plugins: [${plugin}] },
]`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      assert.ok(api.read("dist/a.esm.js").startsWith(`${LONG_BANNER}\n`));
      assert.ok(api.read("dist/b.cjs.js").startsWith(`${LONG_BANNER}\n`));
    },
  );
});

test("unrelated projects keep their own metadata", { skip: SKIP }, () => {
  const other = { name: "beta-app", version: "0.7.0", author: "Beta Team", license: "Apache-2.0" };
  const first = withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      return api.read("dist/main.js");
    },
  );
  const second = withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      packageJson: other,
      config: config(
        `{ build: { entry: "main.js", outdir: "dist" }, plugins: [banner({ year: 2026 })] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      return api.read("dist/main.js");
    },
  );
  assert.ok(first.includes("acme-widget v3.1.4"));
  assert.ok(!first.includes("beta-app"));
  assert.ok(second.includes("beta-app v0.7.0"));
  assert.ok(second.includes("Released under the Apache-2.0 License"));
  assert.ok(!second.includes("acme-widget"));
});

// ---- output filtering -------------------------------------------------------

test("HTML output is never bannered", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: {
        "index.html":
          '<!doctype html>\n<html><head><title>keep</title></head><body><p>keep me</p></body></html>\n',
      },
      config: config(
        `{ build: { entry: "index.html", outdir: "dist" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const htmlFiles = api.find(".html");
      assert.ok(htmlFiles.length > 0, `no html output in ${api.files().join(", ")}`);
      for (const file of htmlFiles) {
        const html = fs.readFileSync(file, "utf8");
        assert.ok(!html.includes("Copyright"), `banner leaked into ${file}`);
        assert.ok(html.includes("keep me"));
      }
    },
  );
});

test("emitted binary assets stay byte-identical", { skip: SKIP }, () => {
  const bytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0x10, 0x20, 0x00, 0x01]);
  withBuild(
    binary,
    {
      files: { "font.woff2": bytes, "main.js": 'import url from "./font.woff2";\nconsole.log(url);\n' },
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", bundle: true, minify: true }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const js = api.read("dist/main.js");
      assert.ok(js.startsWith(`${LONG_BANNER}\n`));
      const emitted = api
        .find(".woff2")
        .filter((f) => f.startsWith(path.join(api.dir, "dist")));
      assert.equal(emitted.length, 1, "expected one emitted woff2 asset");
      assert.ok(
        api.readBinary(path.relative(api.dir, emitted[0])).equals(bytes),
        "emitted asset must be byte-identical",
      );
      const raw = api.readBinary(path.relative(api.dir, emitted[0]));
      assert.equal(raw.includes(Buffer.from("Copyright")), false);
    },
  );
});

test("the metafile JSON output is never bannered", { skip: SKIP }, () => {
  withBuild(
    binary,
    {
      files: { "main.js": SOURCE_JS },
      args: ["--metafile=dist/meta.json"],
      config: config(
        `{ build: { entry: "main.js", outdir: "dist", format: "esm" }, plugins: [${plugin}] }`,
      ),
    },
    (api) => {
      assertBuildOk(api);
      const raw = api.read("dist/meta.json");
      assert.ok(!raw.includes("Copyright"), "metafile must not contain the banner");
      const meta = JSON.parse(raw);
      assert.ok(meta.inputs && Object.keys(meta.inputs).length > 0);
      assert.ok(meta.outputs && Object.keys(meta.outputs).length > 0);
      assert.ok(api.read("dist/main.js").startsWith(`${LONG_BANNER}\n`), "build itself was bannered");
    },
  );
});
