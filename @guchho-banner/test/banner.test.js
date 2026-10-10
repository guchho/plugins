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

const STYLES = [
  "minimal",
  "short",
  "compact",
  "standard",
  "long",
  "production",
  "full",
  "legal",
  "license",
  "author",
  "version",
  "dated",
  "boxed",
  "separated",
  "none",
];

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
    assert.deepEqual(Object.keys(descriptor).sort(), ["banner", "name", "preserveExisting"]);
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
    assert.throws(() => banner({ date: 42 }), /date must be a boolean or a date string/);
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

const RICH_PACKAGE = JSON.stringify(
  {
    name: "my-library",
    version: "1.0.0",
    description: "A useful JavaScript library",
    author: "Your Name",
    contributors: ["Alice", { name: "Bob" }],
    license: "MIT",
    homepage: "https://example.com",
    repository: { type: "git", url: "https://github.com/example/my-library" },
  },
  null,
  2,
);

test("minimal style shows only name and version", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "minimal", year: 2026 }).banner.js;
    assert.equal(text, "/*! truehuman v0.0.6 */");
  });
});

test("version style is an alias of minimal", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const a = banner({ style: "version", year: 2026 }).banner.js;
    const b = banner({ style: "minimal", year: 2026 }).banner.js;
    assert.equal(a, b);
    assert.equal(a, "/*! truehuman v0.0.6 */");
  });
});

test("compact style joins name, version, and license on one line", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "compact", year: 2026 }).banner.js;
    assert.ok(text.startsWith("/*!\n"));
    assert.ok(text.includes(" * truehuman v0.0.6 | GPL-3.0 License"));
    assert.ok(text.includes(" * Copyright (c) 2026 Hemanta Gayen and contributors"));
  });
});

test("standard style uses a License: label", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "standard", year: 2026 }).banner.js;
    assert.ok(text.includes(" * License: GPL-3.0"));
    assert.ok(!text.includes("GPL-3.0 License"));
  });
});

test("production style uses Licensed under with a period", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "production", year: 2026 }).banner.js;
    assert.ok(text.includes(" * Licensed under the GPL-3.0 License."));
  });
});

test("legal style adds a LICENSE file reference", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "legal", year: 2026 }).banner.js;
    assert.ok(text.includes(" * Licensed under the GPL-3.0 License."));
    assert.ok(text.includes(" * See the LICENSE file for details."));
  });
});

test("legal style omits license lines when no license is present", () => {
  withProject({ "package.json": JSON.stringify({ name: "x", version: "1.0.0" }) }, () => {
    const text = banner({ style: "legal", year: 2026 }).banner.js;
    assert.ok(!text.includes("LICENSE"));
    assert.ok(!text.includes("Licensed under"));
  });
});

test("license style focuses on the license reference", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "license", year: 2026 }).banner.js;
    assert.equal(text, "/*! truehuman v0.0.6 | Released under the GPL-3.0 License */");
  });
});

test("author style focuses on name and author", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "author", year: 2026 }).banner.js;
    assert.equal(text, "/*! truehuman v0.0.6 | By Hemanta Gayen and contributors */");
  });
});

test("dated style includes a Date: line", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "dated", year: 2026, date: "2026-10-11" }).banner.js;
    assert.ok(text.includes(" * Date: 2026-10-11"));
  });
});

test("boxed style wraps content in separator lines", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "boxed", year: 2026 }).banner.js;
    const lines = text.split("\n");
    assert.ok(lines[1].includes("================================="));
    assert.ok(lines[lines.length - 2].includes("================================="));
  });
});

test("separated style divides package info from legal details", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ style: "separated", year: 2026 }).banner.js;
    assert.ok(text.includes("---------------------------------"));
    const lines = text.split("\n");
    const sepIndex = lines.findIndex((l) => l.includes("---"));
    assert.ok(sepIndex > 0);
    assert.ok(lines[sepIndex - 1].includes("truehuman"));
  });
});

test("none style returns an empty banner string", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const descriptor = banner({ style: "none", year: 2026 });
    assert.equal(descriptor.banner.js, "");
    assert.equal(descriptor.banner.css, "");
  });
});

test("full style includes all available metadata", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    const text = banner({ style: "full", year: 2026 }).banner.js;
    assert.ok(text.includes(" * Package: my-library"));
    assert.ok(text.includes(" * Version: 1.0.0"));
    assert.ok(text.includes(" * Description: A useful JavaScript library"));
    assert.ok(text.includes(" * Author: Your Name"));
    assert.ok(text.includes(" * Contributors: Alice, Bob"));
    assert.ok(text.includes(" * Copyright (c) 2026 Your Name"));
    assert.ok(text.includes(" * License: MIT"));
    assert.ok(text.includes(" * Homepage: https://example.com"));
    assert.ok(text.includes(" * Repository: https://github.com/example/my-library"));
  });
});

test("full style omits empty fields", () => {
  withProject({ "package.json": JSON.stringify({ name: "solo", version: "1.0.0" }) }, () => {
    const text = banner({ style: "full", year: 2026 }).banner.js;
    assert.ok(text.includes(" * Package: solo"));
    assert.ok(text.includes(" * Version: 1.0.0"));
    assert.ok(!text.includes("Description:"));
    assert.ok(!text.includes("Author:"));
    assert.ok(!text.includes("Homepage:"));
    assert.ok(!text.includes("Repository:"));
    assert.ok(!text.includes("undefined"));
    assert.ok(!text.includes("null"));
  });
});

test("date accepts an explicit date string", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ year: 2026, date: "2026-10-11" }).banner.js;
    assert.ok(text.includes("Built 2026-10-11"));
    const again = banner({ year: 2026, date: "2026-10-11" }).banner.js;
    assert.equal(text, again);
  });
});

test("date true produces today's date in UTC", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const text = banner({ year: 2026, date: true }).banner.js;
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(text.includes(`Built ${today}`));
  });
});

test("preserveExisting defaults to false", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const descriptor = banner({ year: 2026 });
    assert.equal(descriptor.preserveExisting, false);
  });
});

test("preserveExisting accepts true", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    const descriptor = banner({ year: 2026, preserveExisting: true });
    assert.equal(descriptor.preserveExisting, true);
  });
});

test("preserveExisting rejects non-boolean values", () => {
  withProject({ "package.json": FULL_PACKAGE }, () => {
    assert.throws(() => banner({ preserveExisting: "yes" }), /preserveExisting must be a boolean/);
  });
});

test("all styles produce valid block comments", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    for (const style of STYLES) {
      const text = banner({ style, year: 2026 }).banner.js;
      if (style === "none") {
        assert.equal(text, "");
        continue;
      }
      assert.ok(text.startsWith("/*!"), `${style} should start with /*!`);
      assert.ok(text.endsWith("*/"), `${style} should end with */`);
      assert.equal(text.indexOf("*/"), text.lastIndexOf("*/"), `${style} should have one */`);
    }
  });
});

test("all styles emit identical js and css text", () => {
  withProject({ "package.json": RICH_PACKAGE }, () => {
    for (const style of STYLES) {
      const descriptor = banner({ style, year: 2026 });
      assert.equal(descriptor.banner.js, descriptor.banner.css, `${style} js/css mismatch`);
    }
  });
});

test("all styles omit undefined and null in output", () => {
  withProject({ "package.json": JSON.stringify({ name: "x" }) }, () => {
    for (const style of STYLES) {
      const text = banner({ style, year: 2026 }).banner.js;
      assert.ok(!text.includes("undefined"), `${style} contains undefined`);
      assert.ok(!text.includes("null"), `${style} contains null`);
    }
  });
});
