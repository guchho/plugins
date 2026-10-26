import fs from "node:fs";
import path from "node:path";

const PREFIX = "@guchho/dts";

const DECLARATION = /\.d\.(ts|mts|cts)$/i;
const TYPESCRIPT = /\.(ts|tsx|mts|cts)$/i;

function fail(message) {
  throw new Error(`${PREFIX}: ${message}`);
}

// Whether a file name is a declaration file.
export function isDeclarationFile(fileName) {
  return DECLARATION.test(fileName);
}

// Whether a path can carry TypeScript at all - a source or a declaration.
export function isTypeScriptFile(fileName) {
  return TYPESCRIPT.test(fileName);
}

// The key a file is looked up under in an in-memory tree. Windows compares
// paths case-insensitively, so the key folds case exactly where the compiler
// would have.
function referenceKey(ts, fileName) {
  const normalized = fileName.replace(/\\/g, "/");
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
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

// Builds the program over the given entries.
//
// The options start from a declaration-friendly base and are then overlaid,
// in order, by an explicit tsconfig, a discovered tsconfig, and the caller's
// compilerOptions - so an explicit option always beats a file. Emit is left
// enabled because a source entry is turned into declarations through this
// program; a declaration entry is only ever read.
export function createProgram(ts, { entries, tsconfig, compilerOptions, baseDir }) {
  const options = {
    declaration: true,
    emitDeclarationOnly: true,
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

  // Emitting declarations is how a source entry becomes bundleable, so the
  // program must be allowed to emit even when a tsconfig says otherwise.
  options.noEmit = false;

  // Declarations are emitted into memory, never to disk. They still need a
  // directory of their own: if a ".d.ts" landed next to the ".ts" it came from,
  // the compiler would resolve a later import to the source file instead of the
  // declaration, and the bundle would be built from implementations. The
  // directory stays out of node_modules so emitted files are never mistaken for
  // an external package.
  if (options.declarationDir === undefined) {
    options.declarationDir = path.join(baseDir, ".guchho-dts", "declarations");
  }

  const host = ts.createCompilerHost(options);
  return ts.createProgram({ rootNames: toArray(entries), options, host });
}

// A plain posix form of a file name, so a path check works the same on every
// platform.
function normalizeName(fileName) {
  return fileName.replace(/\\/g, "/");
}

// Whether a source file belongs to the project rather than the standard library
// or an installed package; only a project source is emitted to a declaration.
function isProjectSource(ts, program, sourceFile) {
  if (sourceFile.isDeclarationFile) return false;
  if (!isTypeScriptFile(sourceFile.fileName)) return false;
  if (normalizeName(sourceFile.fileName).includes("/node_modules/")) return false;
  if (program.isSourceFileFromExternalLibrary?.(sourceFile)) return false;
  if (program.isSourceFileDefaultLibrary?.(sourceFile)) return false;
  return true;
}

// The module path a declaration keeps in the output tree: the relative path
// from one declaration to another with the declaration suffix dropped, so the
// compiler resolves it as an ordinary module specifier.
function declarationSpecifier(fromDir, target) {
  let relative = path.relative(fromDir, target).replace(/\\/g, "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative.replace(/\.d\.(ts|mts|cts)$/i, "");
}

// Rewrites the module specifiers of one emitted declaration so an import that
// resolved to a project source now points at that source's declaration output.
// A path alias ("@lib/x") that the compiler would otherwise resolve back to the
// ".ts" it came from is redirected to the ".d.ts" the compiler just produced,
// which is what keeps an implementation out of the bundle.
function redirectDeclarationImports(ts, program, sourceToDeclaration, sourceFile, declarationPath, text) {
  const options = program.getCompilerOptions();
  const fromDir = path.dirname(declarationPath);
  const parsed = ts.createSourceFile(declarationPath, text, ts.ScriptTarget.Latest, true);

  const resolve = (specifierText) => {
    if (specifierText === "") return undefined;
    let resolved;
    try {
      resolved = ts.resolveModuleName(specifierText, sourceFile.fileName, options, ts.sys).resolvedModule;
    } catch {
      return undefined;
    }
    if (resolved === undefined) return undefined;
    return sourceToDeclaration.get(referenceKey(ts, resolved.resolvedFileName));
  };

  const edits = [];
  const consider = (literal) => {
    const target = resolve(literal.text);
    if (target === undefined) return;
    edits.push({
      start: literal.getStart(parsed),
      end: literal.getEnd(),
      replacement: JSON.stringify(declarationSpecifier(fromDir, target)),
    });
  };

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      consider(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (argument !== undefined && ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        consider(argument.literal);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);

  if (edits.length === 0) return text;
  edits.sort((a, b) => b.start - a.start);
  let output = text;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}

// Emits declarations for the whole program into memory.
//
// The first pass captures every ".d.ts" the program produces. The second pass,
// one emit per project source, maps that source to its own declaration output
// so an import that names the source can be redirected to the declaration.
// Nothing touches the file system: the outputs are handed to a second program
// instead.
export function emitDeclarations(ts, program, entryFiles) {
  const files = new Map();
  const record = (fileName, text) => {
    if (isDeclarationFile(fileName)) files.set(referenceKey(ts, fileName), text);
  };

  const result = program.emit(undefined, record, undefined, true);
  if (result.emitSkipped) {
    const messages = formatDiagnostics(ts, result.diagnostics ?? []);
    fail(`could not emit declarations${messages ? `:\n${messages}` : ""}`);
  }

  const sourceToDeclaration = new Map();
  const emitted = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (!isProjectSource(ts, program, sourceFile)) continue;
    let output;
    program.emit(
      sourceFile,
      (fileName) => {
        if (output === undefined && isDeclarationFile(fileName)) output = fileName;
      },
      undefined,
      true,
    );
    if (output === undefined) continue;
    const key = referenceKey(ts, output);
    sourceToDeclaration.set(referenceKey(ts, sourceFile.fileName), key);
    emitted.push({ source: sourceFile, output: key });
  }

  for (const { source, output } of emitted) {
    const text = files.get(output);
    if (text === undefined) continue;
    const redirected = redirectDeclarationImports(ts, program, sourceToDeclaration, source, output, text);
    if (redirected !== text) files.set(output, redirected);
  }

  const declarations = entryFiles.map((entry) => {
    const output = sourceToDeclaration.get(referenceKey(ts, entry.fileName));
    if (output === undefined) {
      fail(`could not determine the declaration output for "${entry.fileName}"`);
    }
    return { entry, output };
  });

  return { files, declarations };
}

// A program over declaration files that live in memory, with the disk as a
// fallback so the standard library and installed packages still resolve.
export function createDeclarationProgram(ts, { entries, compilerOptions, files }) {
  const options = { ...compilerOptions };
  delete options.noEmit;

  const key = (fileName) => referenceKey(ts, fileName);
  const host = ts.createCompilerHost(options);

  // The directories that must appear to exist because they hold an in-memory
  // file. Module resolution checks the directory before the file, so a virtual
  // output directory that is never written has to be faked here too.
  const directories = new Set();
  for (const fileName of files.keys()) {
    let dir = key(path.dirname(fileName));
    while (dir !== "" && !directories.has(dir)) {
      directories.add(dir);
      const parent = key(path.dirname(dir));
      if (parent === dir) break;
      dir = parent;
    }
  }

  const diskFileExists = host.fileExists.bind(host);
  const diskReadFile = host.readFile.bind(host);
  const diskDirectoryExists = host.directoryExists?.bind(host);
  const diskRealpath = host.realpath?.bind(host);

  host.fileExists = (fileName) => files.has(key(fileName)) || diskFileExists(fileName);
  host.readFile = (fileName) => {
    const inMemory = files.get(key(fileName));
    return inMemory === undefined ? diskReadFile(fileName) : inMemory;
  };
  if (diskDirectoryExists !== undefined) {
    host.directoryExists = (dir) => directories.has(key(dir)) || diskDirectoryExists(dir);
  }
  if (diskRealpath !== undefined) {
    host.realpath = (fileName) => (files.has(key(fileName)) ? fileName : diskRealpath(fileName));
  }

  return ts.createProgram({ rootNames: toArray(entries), options, host });
}

export { fail };

