import path from "node:path";

const PREFIX = "@guchho/dts";

function fail(message) {
  throw new Error(`${PREFIX}: ${message}`);
}

// The name a declaration file keeps in the output tree: "index.ts" becomes
// "index.d.ts", "index.mts" becomes "index.d.mts", and an input that is already
// a declaration keeps its name.
export function declarationName(fileName) {
  const base = path.basename(fileName);
  if (/\.d\.(ts|mts|cts)$/i.test(base)) return base;
  if (/\.mts$/i.test(base)) return base.replace(/\.mts$/i, ".d.mts");
  if (/\.cts$/i.test(base)) return base.replace(/\.cts$/i, ".d.cts");
  if (/\.tsx?$/i.test(base)) return base.replace(/\.tsx?$/i, ".d.ts");
  return `${base}.d.ts`;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

// The output file name to hand back to the engine for one entry.
//
// An explicit "outfile" names the single output and only makes sense with one
// entry; "dir" collects one declaration per entry under it. With neither, the
// bundle lands beside its entry. A relative option stays relative (the engine
// resolves it against the build's working directory); an absolute one stays
// absolute.
export function outputPathFor({ entry, outfile, dir, multiple }) {
  if (outfile !== undefined) {
    if (multiple) {
      fail("outfile cannot be used with more than one entry; use dir instead");
    }
    return toPosix(outfile);
  }

  if (dir !== undefined) {
    return toPosix(path.join(dir, declarationName(entry)));
  }

  if (multiple) {
    fail("more than one entry needs either outfile or dir to place the bundles");
  }

  return toPosix(path.join(path.dirname(entry), declarationName(entry)));
}

export { fail };
