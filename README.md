# Guchho plugins

Official plugins for the [Guchho](https://github.com/guchho/guchho) bundler. 

Each plugin lives in its own directory, is published to npm under the `@guchho` scope, and has a full README with options, examples, and error reference.

| Plugin | Version | Description |
| --- | --- | --- |
| [`@guchho/banner`](./packages/banner) | [![npm](https://img.shields.io/npm/v/@guchho/banner.svg)](https://www.npmjs.com/package/@guchho/banner) | Copyright and license banner prepended to JavaScript and CSS outputs. |
| [`@guchho/dts`](./packages/dts) | [![npm](https://img.shields.io/npm/v/@guchho/dts.svg)](https://www.npmjs.com/package/@guchho/dts) | TypeScript declaration bundler - one flat `.d.ts` next to your JavaScript. |

## Install

```bash
npm install -D @guchho/banner
npm install -D @guchho/dts typescript
```

## Quick start

```js
import banner from "@guchho/banner";
import dts from "@guchho/dts";

export default {
  build: {
    entry: "src/index.ts",
    outdir: "dist",
    minify: true,
  },
  plugins: [
    banner({ style: "long" }),
    dts({ 
        entry: "src/index.ts",
        outfile: "dist/index.d.ts" 
    }),
  ],
};
```

Requirements: Node.js 20+ and a Guchho release that hosts plugin hooks.

## Repository layout

```
@guchho-banner/   @guchho/banner source, tests, examples
@guchho-dts/      @guchho/dts source, tests, examples
resources/        plugin banner images
.github/workflows npm-publish.yml (manual publish workflow)
```

## Development

Each package is self-contained - run its scripts from inside the package directory:

```bash
cd @guchho-banner
npm install
npm test        # unit + integration (node:test)
npm run verify  # tests + npm pack --dry-run (@guchho/dts also typechecks)
```

Integration tests resolve the Guchho engine from `GUCHHO_PACKAGE`, a sibling `guchho/` checkout, or the installed `guchho` dependency, and skip with an explanation when the engine has no plugin-hook support.

## Publishing

Publishing is manual through the [`npm-publish.yml`](./.github/workflows/npm-publish.yml) workflow. It resolves the package directory from the name, runs `verify`, refuses to republish an existing version, and publishes with `--access public`.

```bash
# dry run first
gh workflow run npm-publish.yml -f plugin=@guchho/banner -f dry_run=true

# publish
gh workflow run npm-publish.yml -f plugin=@guchho/banner -f dry_run=false
```

`NPM_TOKEN` must be configured as a repository secret.

## License

Guchho is licensed under **MIT**. Copyright © [CodeHemu](https://github.com/code-hemu).
