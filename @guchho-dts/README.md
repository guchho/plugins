# @guchho/dts

TypeScript declaration bundler plugin for [Guchho](https://github.com/guchho/guchho) builds.

[![Guchho Plugin dts](https://raw.githubusercontent.com/guchho/plugins/refs/heads/main/resources/guchho_dts_plugin.png)](https://github.com/guchho)

Guchho bundles JavaScript, but a published package also needs one tidy `.d.ts`. This plugin reads your declaration entry with the TypeScript compiler API, inlines every local module it reaches into a single flat declaration file, leaves installed packages as imports, renames colliding declarations, and emits the result as a build asset next to the JavaScript output.

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

```js
import dts from "@guchho/dts";

export default {
  build: {
    entry: "src/index.js",
    outdir: "dist",
  },
  plugins: [
    dts({
      entry: "dist/types/index.d.ts",
      outfile: "dist/index.d.ts",
    }),
  ],
};
```

## How it works

`dts(options)` validates the options immediately and hands back a plugin object.

- `buildStart` builds one TypeScript program over the declaration entry (or entries) and computes every bundle once. A bad option, a missing file, a non-declaration input, or a compiler error fails the build with a plugin-named diagnostic via `this.error` - the build stops, no output is written.
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
| `entry` | `string \| string[]` | - | **Required.** One declaration entry, or several. Resolved against the build's working directory. |
| `outfile` | `string` | - | The single bundle path, e.g. `"dist/index.d.ts"`. Only valid with one entry. Mutually exclusive with `dir`. |
| `dir` | `string` | - | A directory to collect one bundle per entry in. Mutually exclusive with `outfile`. |
| `tsconfig` | `string` | discovered | A tsconfig path, resolved against the build's working directory. When omitted, the nearest `tsconfig.json` at or above the working directory is used. |
| `compilerOptions` | `object` | - | Compiler options layered over the tsconfig before the program is built. |
| `respectExternal` | `boolean` | `true` | Leave imports of installed packages as imports instead of inlining them. |
| `includeExternal` | `string[]` | `[]` | Package names to inline even though they live in `node_modules`. |
| `sourcemap` | `boolean` | `false` | Reserved. Declaration source maps are not emitted yet; setting it raises a warning. |

With neither `outfile` nor `dir`, a single entry is bundled beside itself (`"src/index.d.ts"` becomes `"src/index.d.ts"`). More than one entry needs `outfile` or `dir` to place the bundles.

## Declaration input

The bundler rewrites declarations, not source, so every entry must be a declaration file (`.d.ts`, `.d.mts`, or `.d.cts`). Emit declarations first - for example with `tsc --emitDeclarationOnly` - and point the plugin at that output. Passing a `.ts` file fails the build with a message that says so, rather than emitting a bundle full of function bodies.

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
