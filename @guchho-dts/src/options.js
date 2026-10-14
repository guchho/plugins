const PREFIX = "@guchho/dts";

const KNOWN = new Set([
  "entry",
  "outfile",
  "dir",
  "tsconfig",
  "compilerOptions",
  "respectExternal",
  "includeExternal",
  "sourcemap",
]);

function validateEntry(value) {
  if (typeof value === "string") {
    if (value === "") {
      throw new Error(`${PREFIX}: entry must be a non-empty string`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`${PREFIX}: entry must not be empty`);
    }
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== "string" || value[i] === "") {
        throw new Error(`${PREFIX}: entry[${i}] must be a non-empty string`);
      }
    }
    return;
  }
  throw new Error(`${PREFIX}: entry must be a string or an array of strings`);
}

function validateExternal(value) {
  if (!Array.isArray(value)) {
    throw new Error(`${PREFIX}: includeExternal must be an array of strings`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string" || value[i] === "") {
      throw new Error(`${PREFIX}: includeExternal[${i}] must be a non-empty string`);
    }
  }
}

// Validates the user options once, when dts() is called, so a typo fails the
// configuration before a build starts rather than halfway through one. The
// normalized result is what the hooks read; defaults live here and nowhere
// else. "entry" is required and "outfile" and "dir" cannot both be set.
export function validateOptions(options) {
  if (options === undefined) options = {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error(`${PREFIX}: options must be an object`);
  }

  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new Error(`${PREFIX}: unknown option "${key}"`);
  }

  if (options.entry === undefined) {
    throw new Error(`${PREFIX}: entry is required`);
  }
  validateEntry(options.entry);
  const entry = options.entry;

  let outfile;
  if (options.outfile !== undefined) {
    if (typeof options.outfile !== "string" || options.outfile === "") {
      throw new Error(`${PREFIX}: outfile must be a non-empty string`);
    }
    outfile = options.outfile;
  }

  let dir;
  if (options.dir !== undefined) {
    if (typeof options.dir !== "string" || options.dir === "") {
      throw new Error(`${PREFIX}: dir must be a non-empty string`);
    }
    dir = options.dir;
  }

  if (outfile !== undefined && dir !== undefined) {
    throw new Error(`${PREFIX}: outfile and dir are mutually exclusive`);
  }

  let tsconfig;
  if (options.tsconfig !== undefined) {
    if (typeof options.tsconfig !== "string" || options.tsconfig === "") {
      throw new Error(`${PREFIX}: tsconfig must be a non-empty string`);
    }
    tsconfig = options.tsconfig;
  }

  let compilerOptions;
  if (options.compilerOptions !== undefined) {
    if (
      options.compilerOptions === null ||
      typeof options.compilerOptions !== "object" ||
      Array.isArray(options.compilerOptions)
    ) {
      throw new Error(`${PREFIX}: compilerOptions must be an object`);
    }
    compilerOptions = options.compilerOptions;
  }

  let respectExternal = true;
  if (options.respectExternal !== undefined) {
    if (typeof options.respectExternal !== "boolean") {
      throw new Error(`${PREFIX}: respectExternal must be a boolean`);
    }
    respectExternal = options.respectExternal;
  }

  let includeExternal = [];
  if (options.includeExternal !== undefined) {
    validateExternal(options.includeExternal);
    includeExternal = options.includeExternal.slice();
  }

  let sourcemap = false;
  if (options.sourcemap !== undefined) {
    if (typeof options.sourcemap !== "boolean") {
      throw new Error(`${PREFIX}: sourcemap must be a boolean`);
    }
    sourcemap = options.sourcemap;
  }

  return { entry, outfile, dir, tsconfig, compilerOptions, respectExternal, includeExternal, sourcemap };
}
