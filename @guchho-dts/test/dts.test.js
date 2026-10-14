import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import dts, { validateOptions } from "../src/index.js";
import { declarationName, outputPathFor } from "../src/emit.js";

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-dts-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

function inDir(dir, fn) {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function withProject(files, fn) {
  const dir = makeProject(files);
  try {
    return inDir(dir, () => fn(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The context the engine hands a hook. error throws, exactly like the host.
function pluginContext() {
  return {
    error(message) {
      throw new Error(message instanceof Error ? message.message : String(message));
    },
  };
}

// Runs both hooks and returns the files the plugin asked to emit.
function run(plugin) {
  plugin.buildStart.call(pluginContext());
  const assets = [];
  const warnings = [];
  plugin.generateBundle.call(
    {
      emitFile(file) {
        assets.push(file);
      },
      warn(message) {
        warnings.push(message);
      },
    },
    {},
    {},
  );
  return { assets, warnings };
}

test("default export is the plugin factory", () => {
  assert.equal(typeof dts, "function");
});

test("dts() returns a named plugin with the hooks it implements", () => {
  const plugin = dts({ entry: "index.d.ts" });
  assert.equal(plugin.name, "@guchho/dts");
  assert.equal(typeof plugin.buildStart, "function");
  assert.equal(typeof plugin.generateBundle, "function");
});

test("option validation rejects unknown keys and missing entry", () => {
  assert.throws(() => validateOptions({ nope: true }), /unknown option "nope"/);
  assert.throws(() => validateOptions({}), /entry is required/);
  assert.throws(() => validateOptions({ entry: "" }), /entry must be a non-empty string/);
  assert.throws(() => validateOptions({ entry: [] }), /entry must not be empty/);
  assert.throws(() => validateOptions({ entry: ["a", 2] }), /entry\[1\] must be a non-empty string/);
});

test("option validation rejects an outfile and dir together", () => {
  assert.throws(
    () => validateOptions({ entry: "index.d.ts", outfile: "a.d.ts", dir: "dist" }),
    /outfile and dir are mutually exclusive/,
  );
});

test("option validation rejects wrongly typed fields", () => {
  assert.throws(() => validateOptions({ entry: "a", respectExternal: "yes" }), /respectExternal must be a boolean/);
  assert.throws(() => validateOptions({ entry: "a", includeExternal: "dep" }), /includeExternal must be an array/);
  assert.throws(() => validateOptions({ entry: "a", sourcemap: 1 }), /sourcemap must be a boolean/);
  assert.throws(() => validateOptions({ entry: "a", compilerOptions: [] }), /compilerOptions must be an object/);
});

test("validateOptions normalizes defaults", () => {
  const opts = validateOptions({ entry: "index.d.ts" });
  assert.deepEqual(opts, {
    entry: "index.d.ts",
    outfile: undefined,
    dir: undefined,
    tsconfig: undefined,
    compilerOptions: undefined,
    respectExternal: true,
    includeExternal: [],
    sourcemap: false,
  });
});

test("declarationName maps sources to declaration names", () => {
  assert.equal(declarationName("index.ts"), "index.d.ts");
  assert.equal(declarationName("index.tsx"), "index.d.ts");
  assert.equal(declarationName("index.mts"), "index.d.mts");
  assert.equal(declarationName("index.cts"), "index.d.cts");
  assert.equal(declarationName("index.d.ts"), "index.d.ts");
  assert.equal(declarationName("types"), "types.d.ts");
  assert.equal(declarationName("a/b/index.ts"), "index.d.ts");
});

test("outputPathFor places bundles by option", () => {
  assert.equal(outputPathFor({ entry: "src/index.d.ts", multiple: false }), "src/index.d.ts");
  assert.equal(outputPathFor({ entry: "src/index.ts", multiple: false }), "src/index.d.ts");
  assert.equal(outputPathFor({ entry: "src/index.ts", outfile: "dist/bundle.d.ts", multiple: false }), "dist/bundle.d.ts");
  assert.equal(outputPathFor({ entry: "src/a.ts", dir: "dist", multiple: true }), "dist/a.d.ts");
  assert.throws(
    () => outputPathFor({ entry: "src/a.ts", multiple: true }),
    /more than one entry/,
  );
  assert.throws(
    () => outputPathFor({ entry: "src/a.ts", outfile: "b.d.ts", multiple: true }),
    /outfile cannot be used with more than one entry/,
  );
});

test("a local module is inlined and its imports removed", () => {
  withProject(
    {
      "index.d.ts": 'export { Foo } from "./foo";\nexport declare const x: number;\n',
      "foo.d.ts": "export interface Foo { a: string }\n",
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      assert.equal(assets.length, 1);
      assert.equal(assets[0].type, "asset");
      assert.equal(assets[0].fileName, "out.d.ts");
      const text = String(assets[0].source);
      assert.match(text, /interface Foo \{/);
      assert.match(text, /declare const x: number;/);
      assert.match(text, /export \{ Foo, x \};/);
      assert.doesNotMatch(text, /from "\.\/foo"/);
      assert.doesNotMatch(text, /\bexport interface Foo/);
      assert.doesNotMatch(text, /export declare const/);
    },
  );
});

test("colliding declarations are renamed", () => {
  withProject(
    {
      "index.d.ts": 'export { a } from "./a";\nexport { b } from "./b";\n',
      "a.d.ts": "interface Local { x: number }\nexport declare const a: Local;\n",
      "b.d.ts": "interface Local { y: string }\nexport declare const b: Local;\n",
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /interface Local \{/);
      assert.match(text, /interface Local_1 \{/);
      assert.match(text, /export \{ a, b \};/);
    },
  );
});

test("external imports are left in place by default", () => {
  withProject(
    {
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/dep/index.d.ts": "export interface Dep { n: number }\n",
      "index.d.ts": 'import { Dep } from "dep";\nexport declare const d: Dep;\n',
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /import \{ Dep \} from "dep";/);
      assert.doesNotMatch(text, /interface Dep/);
    },
  );
});

test("includeExternal inlines the named package", () => {
  withProject(
    {
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/dep/index.d.ts": "export interface Dep { n: number }\n",
      "index.d.ts": 'import { Dep } from "dep";\nexport declare const d: Dep;\n',
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts", includeExternal: ["dep"] }));
      const text = String(assets[0].source);
      assert.match(text, /interface Dep/);
      assert.doesNotMatch(text, /from "dep"/);
    },
  );
});

test("respectExternal false inlines every package", () => {
  withProject(
    {
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/dep/index.d.ts": "export interface Dep { n: number }\n",
      "index.d.ts": 'import { Dep } from "dep";\nexport declare const d: Dep;\n',
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts", respectExternal: false }));
      const text = String(assets[0].source);
      assert.match(text, /interface Dep/);
      assert.doesNotMatch(text, /from "dep"/);
    },
  );
});

test("namespaced references are flattened", () => {
  withProject(
    {
      "index.d.ts": 'import * as ns from "./ns";\nexport declare const v: ns.Value;\n',
      "ns.d.ts": "export interface Value { ok: boolean }\n",
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /declare const v: Value;/);
      assert.doesNotMatch(text, /ns\.Value/);
      assert.doesNotMatch(text, /import \* as ns/);
    },
  );
});

test("import type expressions are flattened", () => {
  withProject(
    {
      "index.d.ts": 'export declare const v: import("./ns").Value;\n',
      "ns.d.ts": "export interface Value { ok: boolean }\n",
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /declare const v: Value;/);
      assert.doesNotMatch(text, /import\("\.\/ns"\)/);
    },
  );
});

test("multiple entries produce one bundle each under dir", () => {
  withProject(
    {
      "src/a.d.ts": "export declare const a: number;\n",
      "src/b.d.ts": "export declare const b: string;\n",
    },
    () => {
      const { assets } = run(dts({ entry: ["src/a.d.ts", "src/b.d.ts"], dir: "dist" }));
      assert.equal(assets.length, 2);
      assert.deepEqual(
        assets.map((asset) => asset.fileName).sort(),
        ["dist/a.d.ts", "dist/b.d.ts"],
      );
    },
  );
});

test("a non-declaration entry is rejected", () => {
  withProject({ "index.ts": "export const x = 1;\n" }, () => {
    assert.throws(
      () => run(dts({ entry: "index.ts", outfile: "out.d.ts" })),
      /not a declaration file/,
    );
  });
});

test("a missing entry is rejected", () => {
  withProject({}, () => {
    assert.throws(
      () => run(dts({ entry: "missing.d.ts", outfile: "out.d.ts" })),
      /cannot find declaration entry/,
    );
  });
});

test("compiler errors fail the build with a tsc-style message", () => {
  withProject(
    {
      "index.d.ts": "export declare const x: NotAType;\n",
    },
    () => {
      assert.throws(
        () => run(dts({ entry: "index.d.ts", outfile: "out.d.ts" })),
        /error TS\d+/,
      );
    },
  );
});

test("sourcemap asks for a map and warns that none is written", () => {
  withProject({ "index.d.ts": "export declare const x: number;\n" }, () => {
    const { warnings } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts", sourcemap: true }));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /sourcemap output is not supported yet/);
  });
});

test("a default export keeps its real name and is re-exported as default", () => {
  withProject(
    {
      "index.d.ts": "export default function greet(name: string): string;\nexport declare const x: number;\n",
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /function greet\(name: string\): string;/);
      assert.doesNotMatch(text, /function default/);
      assert.match(text, /export default greet;/);
      assert.match(text, /export \{ x \};/);
    },
  );
});

test("an anonymous default export is named so it can be re-exported", () => {
  withProject({ "index.d.ts": "export default function (n: number): number;\n" }, () => {
    const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
    const text = String(assets[0].source);
    assert.match(text, /function _default\(n: number\): number;/);
    assert.match(text, /export default _default;/);
  });
});

test("a star re-export from a local module is folded into the bundle", () => {
  withProject(
    {
      "index.d.ts": 'export * from "./star";\n',
      "star.d.ts": "export interface Star { s: boolean }\n",
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /interface Star \{/);
      assert.match(text, /export \{ Star \};/);
      assert.doesNotMatch(text, /export \* from/);
    },
  );
});

test("a re-export from an external package is left in place", () => {
  withProject(
    {
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/dep/index.d.ts": "export declare const remote: number;\n",
      "index.d.ts": 'export { remote } from "dep";\nexport declare const local: number;\n',
    },
    () => {
      const { assets } = run(dts({ entry: "index.d.ts", outfile: "out.d.ts" }));
      const text = String(assets[0].source);
      assert.match(text, /export \{ remote \} from "dep";/);
      assert.match(text, /export \{ local \};/);
    },
  );
});
