import { getTypeScript } from "./typescript.js";
import { validateOptions } from "./options.js";
import {
  createDeclarationProgram,
  createProgram,
  emitDeclarations,
  isDeclarationFile,
  isTypeScriptFile,
  resolveEntry,
  toArray,
} from "./program.js";
import { bundleEntry, collectDiagnostics, fail } from "./bundle.js";
import { outputPathFor } from "./emit.js";

const PREFIX = "@guchho/dts";

// TypeScript reports file names with forward slashes; Node's path module on
// Windows hands out backslashes. Folding to one form keeps a map keyed by one
// findable by the other.
function normalize(fileName) {
  return fileName.replace(/\\/g, "/");
}

// Resolves the entries to absolute TypeScript files. Both source files and
// declarations are accepted: a source is turned into declarations by the
// compiler before it is bundled, so an input that carries an implementation is
// the normal case rather than an error.
function resolveEntries(entryOption, baseDir) {
  const options = toArray(entryOption);
  return options.map((entry) => {
    const absolute = resolveEntry(entry, baseDir);
    if (!isTypeScriptFile(absolute)) {
      fail(
        `entry "${entry}" is not a TypeScript file; pass a .ts, .tsx, .mts, ` +
          `.cts, or .d.ts path`,
      );
    }
    return { option: entry, absolute };
  });
}

// The whole build, done once and cached: a program over the entries, the
// project's own diagnostics, one bundled module per entry, and - when an entry
// is a source file - the declarations the compiler emits for it on the way.
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

  const sources = entries.filter((entry) => !isDeclarationFile(entry.absolute));
  const declarations = entries.filter((entry) => isDeclarationFile(entry.absolute));

  let bundleProgram = program;
  let declarationFiles;

  if (sources.length > 0) {
    const emitted = emitDeclarations(
      ts,
      program,
      sources.map((entry) => program.getSourceFile(entry.absolute)),
    );
    declarationFiles = new Map(
      emitted.declarations.map((declaration) => [
        normalize(declaration.entry.fileName),
        declaration.output,
      ]),
    );
    bundleProgram = createDeclarationProgram(ts, {
      entries: [
        ...declarations.map((entry) => entry.absolute),
        ...emitted.declarations.map((declaration) => declaration.output),
      ],
      compilerOptions: program.getCompilerOptions(),
      files: emitted.files,
    });
  }

  const multiple = entries.length > 1;
  const outputs = entries.map((entry) => {
    const declarationPath = declarationFiles?.get(normalize(entry.absolute)) ?? entry.absolute;
    const sourceFile = bundleProgram.getSourceFile(declarationPath);
    if (sourceFile === undefined) {
      fail(`TypeScript did not load "${entry.option}"`);
    }
    const text = bundleEntry(ts, bundleProgram, sourceFile, {
      respectExternal: options.respectExternal,
      includeExternal: options.includeExternal,
    });
    return {
      entry: entry.option,
      fileName: outputPathFor({
        entry: entry.option,
        outfile: options.outfile,
        dir: options.dir,
        multiple,
      }),
      source: text,
    };
  });

  // Two entries that resolve to the same output file would silently overwrite
  // each other, so the collision is named here rather than discovered after a
  // build has already written one over the other.
  const placed = new Map();
  for (const output of outputs) {
    const key = ts.sys.useCaseSensitiveFileNames
      ? output.fileName
      : output.fileName.toLowerCase();
    const previous = placed.get(key);
    if (previous !== undefined) {
      fail(
        `entries "${previous}" and "${output.entry}" both write "${output.fileName}"; ` +
          `give them distinct names or place them in separate directories`,
      );
    }
    placed.set(key, output.entry);
  }

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
      // A watched or repeated build reuses the plugin object, so the previous
      // build's result is discarded here rather than served stale.
      state = null;
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
