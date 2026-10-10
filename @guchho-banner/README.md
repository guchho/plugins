# @guchho/banner

Copyright and license banner plugin for [Guchho](https://github.com/guchho/guchho) JavaScript and CSS build outputs.

A single plugin instance puts a deterministic `/*! ... */` legal comment at the top of every eligible JavaScript and CSS file Guchho generates. It survives minification, keeps source maps correct, coexists with Guchho's built-in banner, and never touches HTML, JSON, source-map files, or binary assets.


[![Guchho Plugin Banner](https://raw.githubusercontent.com/guchho/plugins/refs/heads/main/resources/guchho_banner_plugin.png)](https://github.com/guchho)


## Installation

```bash
npm install -D @guchho/banner
```

## Requirements and verified Guchho compatibility

- **Node.js 18 or newer.** Guchho evaluates `guchho.config.js` by spawning Node, and the plugin runs at config-evaluation time.
- **A Guchho build that reads `plugins` entries as data descriptors.** Guchho's config crosses from Node to the bundler as JSON, so nothing callable survives; this plugin returns a plain descriptor (`{ name, banner: { js, css } }`) that the config loader appends to the built-in banner.

Verified on 2026-10-10 against a local build of Guchho taken from the `guchho` source repository (v1.0.3 plus plugin banner descriptor support), covering:

## Basic configuration

```js
import banner from "@guchho/banner";

export default {
  build: {
    entry: ["src/main.js", "src/styles.css"],
    outdir: "dist",
  },
  plugins: [
    banner({
      style: "long",
      packageJson: "./package.json",
    }),
  ],
};
```

One instance handles every eligible JavaScript and CSS output of the build it belongs to. No separate JS and CSS plugin instances are needed.

## JavaScript output support

The banner is injected at the very beginning of JavaScript outputs, above everything else, in every format Guchho generates (`esm`, `cjs`, `iife`, `umd` verified; `amd`/`system` untested).

- Works with both minified and unminified output.
- The banner uses the legal-comment form `/*! ... */`, which Guchho's minifier preserves.
- Minification is never disabled and its defaults are never changed.
- Directive prologues (`"use strict"`) are unaffected - the banner is a comment, not a statement.
- Source maps account for the banner lines (see [Source-map behavior](#source-map-behavior)).
- The banner appears exactly once per file; the plugin does not inject twice.

## CSS output support

The banner is injected at the very beginning of CSS outputs, above everything else - JavaScript-only support would not be a working plugin.

- Works with minified and unminified CSS.
- Uses valid CSS block-comment syntax (the same text as JavaScript).
- Survives CSS minification without changing selectors, declarations, at-rules, or `@charset` handling.
- Source maps account for the banner lines.
- Appears exactly once per file.

## Supported banner styles

| Style | Description |
| --- | --- |
| `long` (default) | Detailed multiline banner with copyright and license. |
| `short` | Compact, single-line copyright banner. |
| `minimal` | Package name and version only. |
| `compact` | Name, version, and license on one line, copyright below. |
| `standard` | Conventional banner with a `License:` label. |
| `production` | Clean banner for published libraries. |
| `full` | All available package metadata as labeled fields. |
| `legal` | Copyright and licensing focused, with LICENSE file reference. |
| `license` | Package name, version, and license reference only. |
| `author` | Package name, version, and author only. |
| `version` | Alias of `minimal`. |
| `dated` | Copyright with a configurable date line. |
| `boxed` | Decorative banner with `=` separator lines. |
| `separated` | Package info divided from legal details by a `-` line. |
| `none` | No banner is injected. |

### `long` (default)

```js
/*!
 * truehuman v0.0.6
 * Copyright (c) 2026 Hemanta Gayen and contributors
 *
 * Released under the GPL-3.0 License
 */
```

### `short`

```js
/*! truehuman v0.0.6 | Copyright (c) 2026 Hemanta Gayen and contributors | GPL-3.0 License */
```

### `minimal`

```js
/*! my-library v1.0.0 */
```

### `compact`

```js
/*!
 * my-library v1.0.0 | MIT License
 * Copyright (c) 2026 Your Name
 */
```

### `standard`

```js
/*!
 * my-library v1.0.0
 * Copyright (c) 2026 Your Name
 * License: MIT
 */
```

### `production`

```js
/*!
 * my-library v1.0.0
 * Copyright (c) 2026 Your Name
 * Licensed under the MIT License.
 */
```

### `full`

```js
/*!
 * Package: my-library
 * Version: 1.0.0
 * Description: A useful JavaScript library
 * Author: Your Name
 * Copyright (c) 2026 Your Name
 * License: MIT
 * Homepage: https://example.com
 * Repository: https://github.com/example/my-library
 */
```

Only fields with valid values are included. Missing metadata produces no `undefined`, `null`, or empty labels.

### `legal`

```js
/*!
 * my-library v1.0.0
 * Copyright (c) 2026 Your Name
 *
 * Licensed under the MIT License.
 * See the LICENSE file for details.
 */
```

### `license`

```js
/*! my-library v1.0.0 | Released under the MIT License */
```

### `author`

```js
/*! my-library v1.0.0 | By Your Name */
```

### `dated`

```js
/*!
 * my-library v1.0.0
 * Copyright (c) 2026 Your Name
 * License: MIT
 * Date: 2026-10-11
 */
```

### `boxed`

```js
/*!
 * =================================
 * my-library v1.0.0
 * Copyright (c) 2026 Your Name
 * License: MIT
 * =================================
 */
```

### `separated`

```js
/*!
 * my-library v1.0.0
 * ---------------------------------
 * Copyright (c) 2026 Your Name
 * License: MIT
 */
```

### `none`

Returns an empty banner string — no text is injected into any output.

All examples are illustrative: the content comes from your metadata, not from these values. Missing fields are omitted and the remaining segments re-flow cleanly — the plugin never emits `undefined`, `null`, or malformed comments, and metadata containing newlines or `*/` is sanitized so the comment stays intact. Identical inputs produce identical output.

## Option reference

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `style` | `string` | `"long"` | Banner formatting. One of the 15 supported styles. Any other value throws. |
| `packageJson` | `string` | `"./package.json"` | Package metadata file, relative to the config file's directory. |
| `date` | `boolean \| string` | `false` | `true` for today's date (UTC), or an explicit date string like `"2026-10-11"`. |
| `year` | `number \| string` | Current year at config-evaluation time | Copyright year. |
| `preserveExisting` | `boolean` | `false` | When `true`, the descriptor is flagged so the build can skip injection if an existing banner is detected. |
| `name` | `string` | From `package.json` | Override package name. |
| `version` | `string` | From `package.json` | Override package version. |
| `author` | `string` | From `package.json` | Override author. |
| `license` | `string` | From `package.json` | Override license. |

Unknown option names throw, so typos fail fast instead of being ignored. Explicit overrides are plain strings; an empty string clears that field (the segment is omitted).

## Package metadata resolution

- The file is read **once per `banner()` call**, at config-evaluation time - never per output file, and never at module-import time.
- Relative `packageJson` paths resolve against `process.cwd()`, which Guchho sets to the configuration file's own directory when it evaluates the config. The plugin's own installation directory is never consulted. Absolute paths work as-is.
- Fields used: `name`, `version`, `author` (string or `{ name }` object - `email`/`url` are ignored in banners), `license`, `description`, `homepage`, `repository` (string or `{ url }` object), `contributors` (array of strings or `{ name }` objects).
- A missing file, unreadable file, invalid JSON, or non-object JSON is an error (see [Error handling](#error-handling)). Missing *fields* are not: their segments are simply omitted.
- Non-string fields in `package.json` are treated as missing.
- A `version` without a leading `v` gets one (`3.1.4` → `v3.1.4`); one that already has it is not double-prefixed.
- A license value that already ends in `License` is not suffixed again.

## Override precedence

Explicit options always win over `package.json`, and overrides are applied after the file is loaded:

```js
banner({
  year: 1999,
  name: "other",
  version: "9.9.9",
  author: "Someone Else",
  license: "MIT",
});
```

`year` has no `package.json` counterpart - it always comes from the option (defaulting to the current year).

## Built-in banner compatibility

Guchho's own `build.banner` (`{ js, css }`, or a plain string for the JavaScript half) keeps working unchanged. When both are configured:

- the built-in banner is emitted first,
- the plugin banner is appended below it,
- identical text is never appended twice.

```js
export default {
  build: {
    entry: "src/main.js",
    outdir: "dist",
    banner: { js: "/*! Built-in */" },
  },
  plugins: [banner({ year: 2026 })],
};
```

## Minification behavior

- `/*! ... */` is the legal-comment form; Guchho's JavaScript and CSS minifiers preserve it (verified on minified `esm` and `umd` output and minified CSS).
- The plugin never disables minification and never changes minification defaults.
- Unrelated comments are not touched by the plugin; any comment handling by Guchho's minifier is Guchho's own behavior.

## Source-map behavior

- Verified with `sourcemap: true` (linked mode: external `.map` file plus `//# sourceMappingURL=` comment) for both JavaScript and CSS.
- The tests decode the emitted mappings and assert that the first generated line *after* the banner maps back to line 0 of the original source - the banner does not shift mappings.
- `.map` files are JSON outputs and are never bannered; `sources` and `sourcesContent` are preserved.
- Other source-map modes (`inline`, `external`, …) are not tested; no claims are made about them.

## Error handling

Configuration mistakes throw a plain `Error` whose message starts with `@guchho/banner:`:

```text
Error: @guchho/banner: cannot read package metadata at C:\project\nope.json (ENOENT)
```

Guchho surfaces it as `Failed to evaluate "guchho.config.js"` with the stack trace, and **the build fails** (non-zero exit, no output written) - a broken configuration never silently falls back to a banner-less build. Covered cases:

- invalid `style` (anything but one of the 15 supported style names)
- unknown option names and wrong option types
- missing or unreadable `packageJson` file (reported with the resolved path)
- invalid JSON or a non-object JSON document in `packageJson`

## Reproducible builds and the `date` option

- `date: false` (default): no clock reads other than the default `year`. Identical inputs produce byte-identical banners.
- The default `year` is the calendar year at config-evaluation time; pin it with `year: "2026"` if your builds must be bit-stable across New Year.
- `date: true` appends `Built YYYY-MM-DD` in **UTC** to the banner. Output then changes once per UTC day - expected, and documented here rather than hidden.
- `date: "2026-10-11"` uses that exact string, producing deterministic output regardless of when the build runs.

## Examples

JavaScript-only build, short style, overridden metadata:

```js
import banner from "@guchho/banner";

export default {
  build: {
    entry: "src/main.js",
    outfile: "dist/app.js",
    format: "cjs",
    minify: true,
    sourcemap: true,
  },
  plugins: [
    banner({
      style: "short",
      name: "my-app",
      version: "1.4.0",
      license: "MIT",
    }),
  ],
};
```

CSS with a pinned year and the build date:

```js
import banner from "@guchho/banner";

export default {
  build: {
    entry: "src/styles.css",
    outdir: "dist",
    minify: true,
  },
  plugins: [banner({ year: "2024-2026", date: true })],
};
```

Several builds in one config file (each element is its own build):

```js
import banner from "@guchho/banner";

const plugin = [banner({ style: "long" })];

export default [
  { build: { entry: "src/main.js", outfile: "dist/app.esm.js", format: "esm" }, plugins: plugin },
  { build: { entry: "src/main.js", outfile: "dist/app.cjs.js", format: "cjs" }, plugins: plugin },
];
```

A ready-to-copy file lives at [`examples/guchho.config.js`](examples/guchho.config.js).

## Development and testing

```bash
npm test          # unit + integration (node:test, no dependencies)
npm run verify    # tests + npm pack --dry-run
```

- **Unit tests** (`test/banner.test.js`) cover styles, option validation, metadata resolution, overrides, author objects, error cases, sanitization, and determinism. They need no Guchho binary.
- **Integration tests** (`test/integration.test.js`) run real `guchho build` invocations in throwaway projects, installing the package by name so the config's `import banner from "@guchho/banner"` resolves exactly as in a consumer project. They probe the binary for plugin banner support first and skip with an explanation when it is absent.
- Set `GUCHHO_BIN=/path/to/guchho` to test a specific binary (authoritative - if it lacks support, the suite skips instead of testing something else).

Current results: 49 unit tests and 7 integration tests passing (56 total).

## License

Guchho is licensed under **MIT**. Copyright © [CodeHemu](https://github.com/code-hemu).
