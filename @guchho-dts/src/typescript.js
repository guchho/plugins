import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PREFIX = "@guchho/dts";

// The compiler API this plugin needs. TypeScript 7's native compiler ships no
// programmatic API, so importing "typescript" is not enough to know one is
// available: the package has to actually expose createProgram. The official
// compatibility package @typescript/typescript6 re-exports the TypeScript 6
// API, which is what a TypeScript 7 project is expected to install alongside.
const CANDIDATES = [
  "typescript",
  "@typescript/typescript6",
  "@typescript/old",
];

function hasCompilerApi(mod) {
  if (mod === null || typeof mod !== "object") return false;
  return (
    typeof mod.createProgram === "function" &&
    typeof mod.createSourceFile === "function" &&
    typeof mod.sys === "object"
  );
}

function unwrap(mod) {
  if (mod !== null && typeof mod === "object" && hasCompilerApi(mod.default)) {
    return mod.default;
  }
  return mod;
}

let cached;

// Resolves the TypeScript compiler API synchronously. The result is cached for
// the process, because every hook that needs the API wants the same one and the
// package is not expected to change under a running build.
export function getTypeScript() {
  if (cached !== undefined) return cached;

  for (const id of CANDIDATES) {
    let mod;
    try {
      mod = require(id);
    } catch {
      continue;
    }
    const ts = unwrap(mod);
    if (hasCompilerApi(ts)) {
      cached = ts;
      return ts;
    }
  }

  throw new Error(
    `${PREFIX}: no TypeScript compiler API found. Install "typescript" ` +
      `(4.5-6.x). On TypeScript 7, also install "@typescript/typescript6" ` +
      `so the compiler API used for declaration bundling stays available.`,
  );
}
