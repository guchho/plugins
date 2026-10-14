import fs from "node:fs";
import path from "node:path";

const PREFIX = "@guchho/dts";

function fail(message) {
  throw new Error(`${PREFIX}: ${message}`);
}

export function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.slice() : [value];
}

// The nearest tsconfig.json at or above "startDir", or undefined. Mirrors the
// compiler's own upward search so an implicit discovery lands where "tsc" would
// have found it.
export function findTsConfig(ts, startDir) {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  for (;;) {
    const candidate = path.join(current, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    if (current === root) return undefined;
    current = path.dirname(current);
  }
}

// Resolves the entry option to absolute paths, checking each one exists. A
// missing entry is a configuration error worth naming precisely.
export function resolveEntry(entry, baseDir) {
  const resolved = path.resolve(baseDir, entry);
  if (!fs.existsSync(resolved)) {
    fail(`cannot find declaration entry "${entry}" (looked at ${resolved})`);
  }
  return resolved;
}

function defaultModuleResolution(ts) {
  if (ts.ModuleResolutionKind.Bundler !== undefined) {
    return ts.ModuleResolutionKind.Bundler;
  }
  if (ts.ModuleResolutionKind.Node16 !== undefined) {
    return ts.ModuleResolutionKind.Node16;
  }
  return ts.ModuleResolutionKind.NodeJs;
}

// Turns compiler diagnostics into the one-line strings a plugin diagnostic
// carries, so an error reads like one "tsc" would have printed.
export function formatDiagnostics(ts, diagnostics) {
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length === 0) return undefined;
  return errors
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
    .join("\n");
}

// Builds the declaration program for the given entries.
//
// The options start from a declaration-friendly base and are then overlaid,
// in order, by an explicit tsconfig, a discovered tsconfig, and the caller's
// compilerOptions - so an explicit option always beats a file. The program is
// only ever read for its AST and type checker; nothing is emitted through it.
export function createProgram(ts, { entries, tsconfig, compilerOptions, baseDir }) {
  const options = {
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: true,
    moduleResolution: defaultModuleResolution(ts),
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  };

  const configPath = tsconfig
    ? path.resolve(baseDir, tsconfig)
    : findTsConfig(ts, baseDir);

  if (configPath !== undefined) {
    if (!fs.existsSync(configPath)) {
      fail(`cannot find tsconfig "${configPath}"`);
    }
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error !== undefined) {
      fail(formatDiagnostics(ts, [read.error]));
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    Object.assign(options, parsed.options);
  }

  if (compilerOptions !== undefined) {
    Object.assign(options, compilerOptions);
  }

  const host = ts.createCompilerHost(options);
  return ts.createProgram({ rootNames: toArray(entries), options, host });
}

export { fail };
