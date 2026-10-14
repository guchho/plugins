const PREFIX = "@guchho/dts";

function fail(message) {
  throw new Error(`${PREFIX}: ${message}`);
}

// ---------------------------------------------------------------------------
// Module graph
// ---------------------------------------------------------------------------

// Every module specifier a declaration file mentions: static imports, static
// re-exports, and `import()` type expressions.
function moduleSpecifiers(ts, sourceFile) {
  const found = [];
  const seen = new Set();

  const push = (specifier) => {
    if (specifier === undefined) return;
    const text = specifier.text;
    if (typeof text !== "string" || text === "") return;
    if (seen.has(specifier)) return;
    seen.add(specifier);
    found.push(specifier);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      push(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (argument !== undefined && ts.isLiteralTypeNode(argument)) {
        const literal = argument.literal;
        if (ts.isStringLiteral(literal)) push(literal);
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const statement of sourceFile.statements) visit(statement);
  return found;
}

function resolveSpecifier(ts, specifier, containingFile, options, host) {
  const resolved = ts.resolveModuleName(specifier.text, containingFile, options, host);
  return resolved === undefined ? undefined : resolved.resolvedModule;
}

function packageNameOf(fileName) {
  const marker = "/node_modules/";
  const index = fileName.lastIndexOf(marker);
  if (index === -1) return undefined;
  const rest = fileName.slice(index + marker.length);
  const parts = rest.split("/");
  if (parts[0] !== undefined && parts[0].startsWith("@") && parts.length > 1) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

// Decides whether a resolved module is an external dependency that should be
// left as an import rather than inlined. `includeExternal` names packages to
// pull in even from node_modules; `respectExternal: false` inlines everything.
export function makeExternalTest(includeExternal, respectExternal) {
  const include = includeExternal.map((entry) => entry.replace(/\\/g, "/"));

  return (resolvedModule) => {
    if (resolvedModule === undefined) return true;
    const fileName = resolvedModule.resolvedFileName.replace(/\\/g, "/");
    if (!fileName.includes("/node_modules/")) {
      return resolvedModule.isExternalLibraryImport === true;
    }
    const packageName = packageNameOf(fileName);
    if (
      include.some(
        (entry) =>
          entry === packageName ||
          fileName.includes(`/node_modules/${entry}/`),
      )
    ) {
      return false;
    }
    return respectExternal;
  };
}

// Breadth-first walk of the local declaration graph. External modules are
// leaves: they are never traversed and never inlined.
function collectModules(ts, program, entries, compilerOptions, isExternal) {
  const checker = program.getTypeChecker();
  const visited = new Set();
  const order = [];
  const queue = entries.slice();

  while (queue.length > 0) {
    const sourceFile = queue.shift();
    if (visited.has(sourceFile)) continue;
    visited.add(sourceFile);
    order.push(sourceFile);

    for (const specifier of moduleSpecifiers(ts, sourceFile)) {
      const resolved = resolveSpecifier(
        ts,
        specifier,
        sourceFile.fileName,
        compilerOptions,
        ts.sys,
      );
      if (resolved === undefined) continue;
      if (isExternal(resolved)) continue;
      const dependency = program.getSourceFile(resolved.resolvedFileName);
      if (dependency !== undefined && !visited.has(dependency)) {
        queue.push(dependency);
      }
    }
  }

  return { checker, order };
}

// ---------------------------------------------------------------------------
// Symbols and renaming
// ---------------------------------------------------------------------------

function addNamesFromStatement(ts, checker, statement, add) {
  switch (statement.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.ModuleDeclaration:
      add(statement.name);
      break;
    case ts.SyntaxKind.VariableStatement:
      for (const declaration of statement.declarationList.declarations) {
        add(declaration.name);
      }
      break;
    case ts.SyntaxKind.ImportEqualsDeclaration:
      add(statement.name);
      break;
    default:
      break;
  }
}

function declaredSymbols(ts, checker, statement) {
  const symbols = [];
  addNamesFromStatement(ts, checker, statement, (name) => {
    if (name === undefined) return;
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol !== undefined) symbols.push(symbol);
  });
  return symbols;
}

function resolveAlias(ts, checker, symbol) {
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

// Assigns every top-level declaration a unique name. Entries are walked first,
// so a public name keeps its spelling and a colliding private name is renamed.
function buildRenameMap(ts, checker, order) {
  const used = new Set();
  const rename = new Map();

  for (const sourceFile of order) {
    for (const statement of sourceFile.statements) {
      addNamesFromStatement(ts, checker, statement, (name) => {
        if (name === undefined) return;
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol === undefined || rename.has(symbol)) return;
        // The identifier's own text, not the symbol's name: a default-exported
        // declaration has a symbol named "default", which would otherwise
        // rename the declaration to a keyword.
        const base = name.text;
        let final = base;
        if (used.has(final)) {
          let counter = 1;
          while (used.has(`${base}_${counter}`)) counter++;
          final = `${base}_${counter}`;
        }
        used.add(final);
        rename.set(symbol, final);
      });
    }
  }

  return rename;
}

function symbolFinalName(ts, checker, rename, node) {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return undefined;
  return rename.get(resolveAlias(ts, checker, symbol));
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

function hasExport(ts, node) {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers !== undefined && modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefault(ts, node) {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers !== undefined && modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function stripExportModifiers(ts, factory, node) {
  if (!ts.canHaveModifiers(node)) return node;
  const modifiers = ts.getModifiers(node);
  if (modifiers === undefined || modifiers.length === 0) return node;
  const filtered = modifiers.filter(
    (modifier) =>
      modifier.kind !== ts.SyntaxKind.ExportKeyword &&
      modifier.kind !== ts.SyntaxKind.DefaultKeyword,
  );
  if (filtered.length === modifiers.length) return node;
  const next = replaceModifiers(ts, factory, node, filtered);
  return next === undefined ? node : keepComments(ts, next, node);
}

function replaceModifiers(ts, factory, node, modifiers) {
  switch (node.kind) {
    case ts.SyntaxKind.ClassDeclaration:
      return factory.updateClassDeclaration(node, modifiers, node.name, node.typeParameters, node.heritageClauses, node.members);
    case ts.SyntaxKind.FunctionDeclaration:
      return factory.updateFunctionDeclaration(node, modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, node.body);
    case ts.SyntaxKind.InterfaceDeclaration:
      return factory.updateInterfaceDeclaration(node, modifiers, node.name, node.typeParameters, node.heritageClauses, node.members);
    case ts.SyntaxKind.TypeAliasDeclaration:
      return factory.updateTypeAliasDeclaration(node, modifiers, node.name, node.typeParameters, node.type);
    case ts.SyntaxKind.EnumDeclaration:
      return factory.updateEnumDeclaration(node, modifiers, node.name, node.members);
    case ts.SyntaxKind.ModuleDeclaration:
      return factory.updateModuleDeclaration(node, modifiers, node.name, node.body);
    case ts.SyntaxKind.VariableStatement:
      return factory.updateVariableStatement(node, modifiers, node.declarationList);
    default:
      return undefined;
  }
}

function keepComments(ts, next, original) {
  if (original.jsDoc !== undefined) next.jsDoc = original.jsDoc;
  return ts.setOriginalNode(next, original);
}

// ---------------------------------------------------------------------------
// Export collection
// ---------------------------------------------------------------------------

function findExport(ts, checker, moduleSymbol, name) {
  if (moduleSymbol === undefined) return undefined;
  for (const candidate of checker.getExportsOfModule(moduleSymbol)) {
    if (candidate.getName() === name) return candidate;
  }
  return undefined;
}

// The public surface of an entry file: an ordered map of exported name to the
// bundle-local name that supplies it, plus an optional default.
function collectExports(ts, checker, entry, rename) {
  const named = new Map();
  let defaultName;

  for (const statement of entry.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (moduleSpecifier !== undefined) {
        const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
        if (moduleSymbol === undefined) continue;
        if (statement.exportClause === undefined) {
          for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
            const name = symbol.getName();
            if (name === "default") continue;
            const final = rename.get(resolveAlias(ts, checker, symbol));
            if (final !== undefined) named.set(name, final);
          }
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const from = (element.propertyName ?? element.name).text;
            const symbol = findExport(ts, checker, moduleSymbol, from);
            const target = symbol === undefined ? undefined : resolveAlias(ts, checker, symbol);
            const final = target === undefined ? undefined : rename.get(target);
            if (final !== undefined) named.set(element.name.text, final);
          }
        }
        continue;
      }

      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const local = element.propertyName ?? element.name;
          const symbol = checker.getSymbolAtLocation(local);
          const final = rename.get(resolveAlias(ts, checker, symbol)) ?? local.text;
          named.set(element.name.text, final);
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = statement.expression;
      if (ts.isIdentifier(expression)) {
        defaultName = symbolFinalName(ts, checker, rename, expression) ?? expression.text;
      }
      continue;
    }

    if (hasExport(ts, statement)) {
      if (hasDefault(ts, statement)) {
        if (statement.name === undefined) {
          defaultName = ANONYMOUS_DEFAULT;
        } else {
          const symbol = checker.getSymbolAtLocation(statement.name);
          defaultName = (symbol === undefined ? undefined : rename.get(symbol)) ?? statement.name.text;
        }
        continue;
      }
      addNamesFromStatement(ts, checker, statement, (name) => {
        if (name === undefined) return;
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol === undefined) return;
        named.set(name.text, rename.get(symbol) ?? name.text);
      });
    }
  }

  return { named, defaultName };
}

// ---------------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------------

const ANONYMOUS_DEFAULT = "_default";

function isExternalSpecifier(ts, specifier, sourceFile, compilerOptions, isExternal) {
  const resolved = resolveSpecifier(ts, specifier, sourceFile.fileName, compilerOptions, ts.sys);
  return isExternal(resolved);
}

function localNamespaces(checker, order) {
  const set = new Set();
  for (const sourceFile of order) {
    if (sourceFile.symbol !== undefined) set.add(sourceFile.symbol);
  }
  return set;
}

function makeVisitor(ts, checker, rename, context, state) {
  const factory = context.factory;

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) {
        return state.isExternal(specifier) ? ts.visitEachChild(node, visit, context) : undefined;
      }
      return undefined;
    }

    if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && reference.expression !== undefined) {
        return state.isExternal(reference.expression) ? ts.visitEachChild(node, visit, context) : undefined;
      }
      return undefined;
    }

    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier) && state.isExternal(specifier)) {
        return ts.visitEachChild(node, visit, context);
      }
      return undefined;
    }

    if (ts.isExportAssignment(node)) return undefined;

    // A string literal keeps no text of its own once it is printed from a
    // synthetic file (the printer slices literals out of their source text), so
    // every one that survives is rebuilt from its own value.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return factory.createStringLiteral(node.text);
    }

    if (ts.isNumericLiteral(node)) {
      return factory.createNumericLiteral(node.text);
    }

    if (ts.isImportTypeNode(node)) {
      const rewritten = flattenImportType(ts, checker, rename, state, node);
      if (rewritten !== undefined) return keepComments(ts, rewritten, node);
      return node;
    }

    if (ts.isQualifiedName(node) || ts.isPropertyAccessExpression(node)) {
      const flattened = flattenNamespaceAccess(ts, checker, rename, state, node);
      if (flattened !== undefined) return keepComments(ts, flattened, node);
      return ts.visitEachChild(node, visit, context);
    }

    if (ts.isIdentifier(node)) {
      const final = symbolFinalName(ts, checker, rename, node);
      if (final !== undefined && final !== node.text) {
        return keepComments(ts, factory.createIdentifier(final), node);
      }
      return node;
    }

    let current = node;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && hasDefault(ts, node) && node.name === undefined) {
      current = nameAnonymousDefault(ts, factory, node);
    }
    if (hasExport(ts, current)) {
      current = stripExportModifiers(ts, factory, current);
    }
    return ts.visitEachChild(current, visit, context);
  };

  return visit;
}

function nameAnonymousDefault(ts, factory, node) {
  const name = factory.createIdentifier(ANONYMOUS_DEFAULT);
  const next = ts.isFunctionDeclaration(node)
    ? factory.updateFunctionDeclaration(node, ts.getModifiers(node), node.asteriskToken, name, node.typeParameters, node.parameters, node.type, node.body)
    : factory.updateClassDeclaration(node, ts.getModifiers(node), name, node.typeParameters, node.heritageClauses, node.members);
  return keepComments(ts, next, node);
}

// `import("./local").Foo` becomes the flattened `Foo`. An external import type
// is left alone.
function flattenImportType(ts, checker, rename, state, node) {
  const qualifier = node.qualifier;
  if (qualifier === undefined) return undefined;
  const symbol = checker.getSymbolAtLocation(qualifier);
  if (symbol === undefined) return undefined;
  const target = resolveAlias(ts, checker, symbol);
  const final = rename.get(target);
  if (final === undefined) return undefined;
  return state.factory.createTypeReferenceNode(final, undefined);
}

function safeAlias(ts, checker, symbol) {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

// `NS.Foo` where `NS` is a namespace import of a bundled module becomes `Foo`.
function flattenNamespaceAccess(ts, checker, rename, state, node) {
  const leftSymbol = checker.getSymbolAtLocation(node.left);
  if (leftSymbol === undefined) return undefined;
  const target = safeAlias(ts, checker, leftSymbol);
  if (target === undefined || !state.namespaces.has(target)) return undefined;
  const rightName = node.right.text;
  const exported = findExport(ts, checker, target, rightName);
  if (exported === undefined) return undefined;
  const final = rename.get(resolveAlias(ts, checker, exported));
  if (final === undefined) return undefined;
  return state.factory.createIdentifier(final);
}

// Transforms every statement of the graph into one flat list and prints it.
function emitBundle(ts, checker, order, rename, named, defaultName, isExternal, compilerOptions) {
  const factory = ts.factory;
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const namespaces = localNamespaces(checker, order);
  const chunks = [];

  for (const sourceFile of order) {
    const state = {
      factory,
      namespaces,
      isExternal: (specifier) => isExternalSpecifier(ts, specifier, sourceFile, compilerOptions, isExternal),
    };
    const synthetic = factory.createSourceFile(
      sourceFile.statements.slice(),
      factory.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None,
    );
    const result = ts.transform(synthetic, [
      (context) => (root) => ts.visitNode(root, makeVisitor(ts, checker, rename, context, state)),
    ]);
    const transformed = result.transformed[0];
    const text = printer.printFile(transformed).trim();
    result.dispose();
    if (text !== "") chunks.push(text);
  }

  const exports = [];
  for (const [exported, local] of named) {
    exports.push(exported === local ? exported : `${local} as ${exported}`);
  }
  if (exports.length > 0) {
    chunks.push(`export { ${exports.join(", ")} };`);
  }
  if (defaultName !== undefined) {
    chunks.push(`export default ${defaultName};`);
  }

  return chunks.join("\n\n") + (chunks.length > 0 ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

// Compiler errors that belong to the project rather than to the standard
// library or an installed package, formatted the way tsc formats them.
export function collectDiagnostics(ts, program) {
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  const messages = [];
  for (const diagnostic of diagnostics) {
    const file = diagnostic.file;
    if (file !== undefined) {
      const name = file.fileName.replace(/\\/g, "/");
      if (name.includes("/node_modules/") || name.includes("/lib.") || name.includes("/@types/")) {
        continue;
      }
      const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      messages.push(
        `${file.fileName}(${position.line + 1},${position.character + 1}): error TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      );
    } else {
      messages.push(`error TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// Bundles one declaration entry into a single module's text.
export function bundleEntry(ts, program, entry, options) {
  const compilerOptions = program.getCompilerOptions();
  const isExternal = makeExternalTest(options.includeExternal, options.respectExternal);
  const { checker, order } = collectModules(ts, program, [entry], compilerOptions, isExternal);

  if (order.length === 0) {
    fail(`no declarations found for entry "${entry.fileName}"`);
  }

  const rename = buildRenameMap(ts, checker, order);
  const { named, defaultName } = collectExports(ts, checker, entry, rename);
  return emitBundle(ts, checker, order, rename, named, defaultName, isExternal, compilerOptions);
}

export { fail };
