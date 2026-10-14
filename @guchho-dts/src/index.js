import { getTypeScript } from "./typescript.js";
import { validateOptions } from "./options.js";
import { createProgram, resolveEntry, toArray } from "./program.js";
import { bundleEntry, collectDiagnostics, fail } from "./bundle.js";
import { outputPathFor } from "./emit.js";

const PREFIX = "@guchho/dts";

const DECLARATION = /\.d\.(ts|mts|cts)$/i;

// Resolves the entries to absolute declaration files. The bundler rewrites
// declarations, not source, so an input that would carry an implementation is a
// configuration error rather than a bundle full of function bodies.
function resolveEntries(entryOption, baseDir) {
  const options = toArray(entryOption);
  return options.map((entry) => {
    const absolute = resolveEntry(entry, baseDir);
    if (!DECLARATION.test(absolute)) {
      fail(
        `entry "${entry}" is not a declaration file; pass a .d.ts ` +
          `(emit declarations first, for example with "tsc --emitDeclarationOnly")`,
      );
    }
    return { option: entry, absolute };
  });
}

// The whole build, done once and cached: a program over the entries, the
// project's own diagnostics, and one bundled module per entry. buildStart runs
// it so a configuration or compiler error surfaces before the bundle is
// assembled; generateBundle only emits what was computed.
function compute(options, baseDir) {
  const ts = getTypeScript();
  const entries = resolveEntries(options.entry, baseDir);

  const program = createProgram(ts, {
    entries: entries.map((entry) => entry.absolute),
    tsconfig: options.tsconfig,
    compilerOptions: options.compilerOptions,
    baseDir,
  });

  const diagnostics = collectDiagnostics(ts, program);
  if (diagnostics.length > 0) {
    fail(`declaration errors:\n${diagnostics.join("\n")}`);
  }

  const multiple = entries.length > 1;
  const outputs = entries.map((entry) => {
    const sourceFile = program.getSourceFile(entry.absolute);
    if (sourceFile === undefined) {
      fail(`TypeScript did not load "${entry.option}"`);
    }
    const text = bundleEntry(ts, program, sourceFile, {
      respectExternal: options.respectExternal,
      includeExternal: options.includeExternal,
    });
    return {
      fileName: outputPathFor({
        entry: entry.option,
        outfile: options.outfile,
        dir: options.dir,
        multiple,
      }),
      source: text,
    };
  });

  return { outputs, sourcemap: options.sourcemap };
}

// A declaration bundler for Guchho. It builds a TypeScript program over the
// given declaration entry (or entries), inlines every local module they reach,
// leaves external packages as imports, renames colliding declarations, and
// emits one flat module per entry as a build asset.
export function dts(options) {
  const opts = validateOptions(options);
  let state = null;

  const buildState = (context) => {
    if (state !== null) return state;
    try {
      state = compute(opts, process.cwd());
    } catch (error) {
      state = { outputs: [], sourcemap: false };
      context.error(error);
    }
    return state;
  };

  return {
    name: PREFIX,

    buildStart() {
      buildState(this);
    },

    generateBundle() {
      const built = buildState(this);
      for (const output of built.outputs) {
        this.emitFile({ type: "asset", fileName: output.fileName, source: output.source });
      }
      if (built.sourcemap) {
        this.warn("sourcemap output is not supported yet; no map was written");
      }
    },
  };
}

export { validateOptions } from "./options.js";
export { declarationName, outputPathFor } from "./emit.js";

export default dts;
