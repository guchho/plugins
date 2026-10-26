# @guchho/dts

TypeScript declaration bundler plugin for [Guchho](https://github.com/guchho/guchho) builds.

Guchho bundles JavaScript, but a published package also needs one tidy `.d.ts`. This plugin reads your declaration entry with the TypeScript compiler API, inlines every local module it reaches into a single flat declaration file, leaves installed packages as imports, renames colliding declarations, and emits the result as a build asset next to the JavaScript output.

[![Guchho Plugin dts](https://raw.githubusercontent.com/guchho/plugins/refs/heads/main/resources/guchho_dts_plugin.png)](https://github.com/guchho)

## Installation

```bash
npm install -D @guchho/dts typescript
```

## Requirements

- **Node.js 20 or newer.**
- **The TypeScript compiler API.** The plugin builds a `ts.Program` to read and rewrite declarations, which means it needs a real compiler API at run time:
  - TypeScript 4.5 through 6.x ship the API directly.
  - **TypeScript 7 ships no compiler API.** On a TypeScript 7 project, also install [`@typescript/typescript6`](https://www.npmjs.com/package/@typescript/typescript6), which re-exports the TypeScript 6 API. The plugin looks for `typescript` first, then `@typescript/typescript6`, and reports an actionable error if it finds neither.
- **A Guchho that hosts plugin hooks.** The plugin is an object with `buildStart` and `generateBundle` and needs the engine that runs the plugin bridge.

## Basic configuration

Point the plugin at the TypeScript source. It compiles the source to declarations
in memory and bundles them, so no separate `tsc --emitDeclarationOnly` step is
needed before a build:

```js
import dts from "@guchho/dts";

export default {
  build: {
    entry: "src/index.ts",
    outdir: "dist",
  },
  plugins: [
    dts({
      entry: "src/index.ts",
      outfile: "dist/index.d.ts",
    }),
  ],
};
```

Guchho compiles `src/index.ts` to `dist/index.js`; the plugin emits
`dist/index.d.ts` next to it. To bundle declarations you already have instead,
pass the `.d.ts` entry and the plugin bundles it as is:

```js
dts({ entry: "dist/types/index.d.ts", outfile: "dist/index.d.ts" });
```

## How it works

`dts(options)` validates the options immediately and hands back a plugin object.

- `buildStart` runs the whole build once: a TypeScript program over the entries, the project's diagnostics, and one bundled module per entry. A source entry is compiled to in-memory declarations first, so no separate `tsc` step is needed. A bad option, a missing file, a non-TypeScript input, or a compiler error fails the build with a plugin-named diagnostic via `this.error` - the build stops, no output is written.
- `generateBundle` emits each bundle as an asset with `this.emitFile`, so it lands wherever `outfile`/`dir` says alongside the engine's own outputs.

The bundler walks the local declaration graph, so a statement only has to be right once:

- **Local modules are inlined.** Every `import`/`export`/`import()` that resolves inside the project is followed and its declarations folded into the output; the import itself is dropped.
- **Installed packages stay external** by default. Their imports are left exactly as written, so the consumer resolves the same package.
- **Colliding declarations are renamed.** Two modules that both declare `Thing` become `Thing` and `Thing_1`, and every reference is rewritten to match.
- **Exports are flattened.** All `export` and `export default` modifiers are stripped from the bodies and re-expressed once at the end as `export { ... }` and `export default ...`.
- **Namespace and import-type references are flattened.** `ns.Value` and `import("./ns").Value` become the flattened `Value`.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entry` | `string \| string[]` | - | **Required.** One entry, or several. Resolved against the build's working directory. A `.ts`/`.tsx`/`.mts`/`.cts` source is compiled to declarations before bundling; a `.d.ts` is bundled as is. |
| `outfile` | `string` | - | The single bundle path, e.g. `"dist/index.d.ts"`. Only valid with one entry. Mutually exclusive with `dir`. |
| `dir` | `string` | - | A directory to collect one bundle per entry in. Mutually exclusive with `outfile`. |
| `tsconfig` | `string` | discovered | A tsconfig path, resolved against the build's working directory. When omitted, the nearest `tsconfig.json` at or above the working directory is used. |
| `compilerOptions` | `object` | - | Compiler options layered over the tsconfig before the program is built. |
| `respectExternal` | `boolean` | `true` | Leave imports of installed packages as imports instead of inlining them. |
| `includeExternal` | `string[]` | `[]` | Package names to inline even though they live in `node_modules`. |
| `sourcemap` | `boolean` | `false` | Reserved. Declaration source maps are not emitted yet; setting it raises a warning. |

With neither `outfile` nor `dir`, a single entry is bundled beside itself (`"src/index.d.ts"` becomes `"src/index.d.ts"`, and `"src/index.ts"` becomes `"src/index.d.ts"`). More than one entry needs `outfile` or `dir` to place the bundles.

## Input

An entry may be a source or a declaration:

- **A source file** (`.ts`, `.tsx`, `.mts`, `.cts`) is compiled to declarations in memory with the TypeScript API, then bundled. The emitted declarations live in a temporary directory that is never written to disk and never mistaken for an installed package.
- **A declaration file** (`.d.ts`, `.d.mts`, `.d.cts`) is bundled directly.

A source and a declaration entry can be mixed in one build. Any other extension fails the build with a message that says so.

TypeScript 7 ships no compiler API, so on a TypeScript 7 project install `@typescript/typescript6` alongside this plugin. The plugin prefers `typescript` and falls back to `@typescript/typescript6` when the installed `typescript` exposes no API.

In practice, the declaration bundler runs next to the JavaScript build. Adding it to the same config object means the `.d.ts` lands in `dist` with the JavaScript, with no second build:

```js
export default [
  {
    entry: "src/index.ts",
    outdir: "dist",
    format: "esm",
    plugins: [dts({ entry: "src/index.ts", outfile: "dist/index.d.ts" })],
  },
];
```

## Common errors

Every failure is raised through `this.error` with the `@guchho/dts` prefix, so the
build stops before any declaration is written.

| Message | Cause | Fix |
| --- | --- | --- |
| `no TypeScript compiler API found` | Neither `typescript` nor `@typescript/typescript6` is installed. | `npm install -D typescript`. |
| `cannot find declaration entry "…"` | The `entry` path does not exist. | Check the path; it is resolved against the build's working directory. |
| `entry "…" is not a TypeScript file` | The entry is not `.ts`, `.tsx`, `.mts`, `.cts` or a declaration. | Point `entry` at a TypeScript file. |
| `cannot find tsconfig "…"` | An explicit `tsconfig` path does not exist. | Correct the path or remove the option. |
| `declaration errors:` followed by `error TS…` | TypeScript reported a syntax or type error in the project. | Read the file, line and code; fix the source. |
| `entries "…" and "…" both write "…"` | Two entries resolve to the same output file. | Give the entries distinct names, or use `dir`. |
| `could not emit declarations` | Declaration emit was skipped. | The accompanying TypeScript diagnostic names the file. |

Path aliases (`paths` / `baseUrl`, with `extends`) are resolved through the
declaration output, so an `@lib/x` import is bundled from `@lib/x` and never pulls
the implementation back in.

## Limits

- **No declaration source maps.** The option is accepted and warns; nothing is written.
- **`export =` is not bundled.** Entry files that use the CommonJS `export =` form are not supported yet.
- **`export * as ns from "./local"`** (`NamespaceExport`) is not folded in.
- A default export expression that is not an identifier (`export default { ... }`) is dropped.

## Publish a single declaration

`npm pack --dry-run` reads `files`, so the published package carries only `src/`. Everything the plugin emits is a build output, not part of the package.

## Tests

- **Unit tests** (`test/dts.test.js`) cover option validation, name placement, the bundling pipeline (inlining, renaming, external handling, namespace and import-type flattening, default and star exports), and error cases. They need no Guchho binary.
- **Integration tests** (`test/integration.test.js`) run a real Guchho build and assert the emitted `.d.ts`. They resolve the engine deliberately, probe it for plugin support, and skip with an explanation when the engine does not host hooks.

```bash
npm test
```

## Notes

- The plugin never copies code from `rollup-plugin-dts` (which is LGPL-3.0); the bundler here is written against the TypeScript API directly.
- The plugin host's `this.resolve` and `this.getFileName` are not wired in Guchho yet. A declaration bundler only needs `buildStart` and `generateBundle`, so it is unaffected.

## License

Guchho is licensed under **MIT**. Copyright © [CodeHemu](https://github.com/code-hemu).
