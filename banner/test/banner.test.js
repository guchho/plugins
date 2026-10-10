import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import banner from "../src/index.js";

const FULL_PACKAGE = JSON.stringify(
  {
    name: "truehuman",
    version: "0.0.6",
    author: "Hemanta Gayen and contributors",
    license: "GPL-3.0",
  },
  null,
  2,
);

const LONG_EXAMPLE = [
  "/*!",
  " * truehuman v0.0.6",
  " * Copyright (c) 2026 Hemanta Gayen and contributors",
  " *",
  " * Released under the GPL-3.0 License",
  " */",
].join("\n");

const SHORT_EXAMPLE =
  "/*! truehuman v0.0.6 | Copyright (c) 2026 Hemanta Gayen and contributors | GPL-3.0 License */";

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guchho-banner-"));
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

test("default export is a function", () => {
  assert.equal(typeof banner, "function");
});

test("returns the descriptor shape with identical js and css text", () => {
  withProject({ "package.json": FULL_PACKAGE }, (dir) => {
    const descriptor = banner({ packageJson: path.join(dir, "package.json"), year: 2026 });
    assert.deepEqual(Object.keys(descriptor).sort(), ["banner", "name"]);
    assert.equal(descriptor.name, "@guchho/banner");
    assert.deepEqual(Object.keys(descriptor.banner).sort(), ["css", "js"]);
    assert.equal(descriptor.banner.css, descriptor.banner.js);
  });
});

test("default style is long and matches the documented example", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.equal(banner({ year: 2026 }).banner.js, LONG_EXAMPLE);
  });
});

test("short style matches the documented example", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.equal(banner({ style: "short", year: 2026 }).banner.js, SHORT_EXAMPLE);
  });
});

test("invalid style is rejected with a clear error", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.throws(() => banner({ style: "tiny" }), /@guchho\/banner: invalid style "tiny"/);
    assert.throws(() => banner({ style: 42 }), /invalid style/);
  });
});

test("unknown options are rejected", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.throws(() => banner({ styles: "long" }), /unknown option "styles"/);
  });
});

test("non-object options are rejected", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.throws(() => banner("long"), /options must be an object/);
    assert.throws(() => banner(null), /options must be an object/);
  });
});

test("option types are validated", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.throws(() => banner({ packageJson: 42 }), /packageJson must be a non-empty string/);
    assert.throws(() => banner({ packageJson: "" }), /packageJson must be a non-empty string/);
    assert.throws(() => banner({ date: "yes" }), /date must be a boolean/);
    assert.throws(() => banner({ year: null }), /year must be a number or a string/);
    assert.throws(() => banner({ name: 7 }), /name must be a string/);
    assert.throws(() => banner({ version: true }), /version must be a string/);
    assert.throws(() => banner({ author: {} }), /author must be a string/);
    assert.throws(() => banner({ license: [] }), /license must be a string/);
  });
});

test("missing package file reports the resolved path", () => {
  withProject({}, () => {
    assert.throws(
      () => banner({ packageJson: "./missing.json" }),
      (error) =>
        /^@guchho\/banner: cannot read package metadata at /.test(error.message) &&
        error.message.includes("missing.json"),
    );
  });
});

test("invalid JSON is reported with context", () => {
  withProject({ "package.json": "{ not json" }, () => {
    assert.throws(() => banner(), /is not valid JSON/);
  });
});

test("non-object metadata is rejected", () => {
  withProject({ "package.json": "[1, 2, 3]" }, () => {
    assert.throws(() => banner(), /must be a JSON object/);
  });
});

test("relative packageJson resolves against the working directory", () => {
  withProject(
    {
      "package.json": FULL_PACKAGE,
      "config/metadata.json": JSON.stringify({ name: "nested", version: "1.2.3" }),
    },
    () => {
      assert.match(banner({ packageJson: "./config/metadata.json", year: 2026 }).banner.js, /nested v1\.2\.3/);
      assert.match(banner({ year: 2026 }).banner.js, /truehuman v0\.0\.6/);
    },
  );
});

test("missing optional metadata omits segments without undefined or null", () => {
  withProject({ "package.json": JSON.stringify({ name: "solo" }) }, () => {
    const text = banner({ year: 2026 }).banner.js;
    assert.equal(text, ["/*!", " * solo", " * Copyright (c) 2026", " */"].join("\n"));
    assert.doesNotMatch(text, /undefined|null/);
  });
});

test("metadata that omits name and version leaves only the copyright line", () => {
  withProject({ "package.json": "{}" }, () => {
    const text = banner({ year: 2026 }).banner.js;
    assert.equal(text, ["/*!", " * Copyright (c) 2026", " */"].join("\n"));
  });
});

test("explicit overrides beat package.json on every field", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({
      year: 1999,
      name: "other",
      version: "9.9.9",
      author: "Someone Else",
      license: "MIT",
    }).banner.js;
    assert.match(text, /other v9\.9\.9/);
    assert.match(text, /Copyright \(c\) 1999 Someone Else/);
    assert.match(text, /Released under the MIT License/);
    assert.doesNotMatch(text, /truehuman|GPL-3\.0|Hemanta/);
  });
});

test("author objects contribute their name only", () => {
  withProject(
    { "package.json": JSON.stringify({ name: "x", version: "1.0.0", author: { name: "Ada Lovelace", email: "ada@example.com" } }) },
    () => {
      const text = banner({ year: 2026 }).banner.js;
      assert.match(text, /Ada Lovelace/);
      assert.doesNotMatch(text, /ada@example\.com/);
    },
  );
});

test("author objects without a name count as missing", () => {
  withProject(
    { "package.json": JSON.stringify({ name: "x", version: "1.0.0", author: { email: "a@b.c" } }) },
    () => {
      const text = banner({ year: 2026 }).banner.js;
      assert.doesNotMatch(text, /a@b\.c|undefined|null/);
    },
  );
});

test("a license that already reads as one is not suffixed twice", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "short", license: "MIT License", year: 2026 }).banner.js;
    assert.match(text, /\| MIT License \*/);
    assert.doesNotMatch(text, /MIT License License/);
  });
});

test("version overrides are not double-prefixed with v", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.match(banner({ version: "v2.0.0", year: 2026 }).banner.js, /truehuman v2\.0\.0/);
    assert.doesNotMatch(banner({ version: "v2.0.0", year: 2026 }).banner.js, /vv2/);
  });
});

test("date is disabled by default and enabled explicitly", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.doesNotMatch(banner({ year: 2026 }).banner.js, /Built/);
    assert.match(banner({ date: true, year: 2026 }).banner.js, /Built \d{4}-\d{2}-\d{2}/);
    assert.match(banner({ style: "short", date: true, year: 2026 }).banner.js, /Built \d{4}-\d{2}-\d{2}/);
  });
});

test("identical inputs produce identical output when date is off", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const a = banner({ year: 2026 });
    const b = banner({ year: 2026 });
    assert.deepEqual(a, b);
  });
});

test("metadata containing comment terminators and newlines stays inside one comment", () => {
  withProject(
    { "package.json": JSON.stringify({ name: "evil */ name", version: "1.0\n0", author: "A\nB */ C" }) },
    () => {
      const text = banner({ year: 2026 }).banner.js;
      assert.equal(text.indexOf("*/"), text.lastIndexOf("*/"));
      assert.match(text, /evil \* \/ name/);
      assert.match(text, /A B \* \/ C/);
      assert.doesNotMatch(text, /1\.0\n0/);
    },
  );
});

test("an empty banner is still a valid comment", () => {
  withProject({ "package.json": "{}" }, () => {
    assert.equal(banner({ year: "" }).banner.js, "/*! */");
    assert.equal(banner({ year: "", style: "short" }).banner.js, "/*! */");
  });
});

test("year accepts strings", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.match(banner({ year: "2020-2026" }).banner.js, /Copyright \(c\) 2020-2026/);
  });
});

test("banner() with no options uses every default", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.equal(banner().banner.js, LONG_EXAMPLE.replace("2026", String(new Date().getFullYear())));
  });
});

test("metadata does not leak between projects", () => {
  const first = makeProject({ "package.json": JSON.stringify({ name: "first", version: "1.0.0" }) });
  const second = makeProject({ "package.json": JSON.stringify({ name: "second", version: "2.0.0" }) });
  try {
    const a = inDir(first, () => banner({ year: 2026 }).banner.js);
    const b = inDir(second, () => banner({ year: 2026 }).banner.js);
    assert.match(a, /first v1\.0\.0/);
    assert.doesNotMatch(a, /second/);
    assert.match(b, /second v2\.0\.0/);
    assert.doesNotMatch(b, /first/);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
