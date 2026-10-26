import fs from "node:fs";
import path from "node:path";

const PREFIX = "@guchho/banner";
const DEFAULT_PACKAGE_JSON = "./package.json";
const STYLES = new Set([
  "minimal",
  "short",
  "compact",
  "standard",
  "long",
  "production",
  "full",
  "legal",
  "license",
  "author",
  "version",
  "dated",
  "boxed",
  "separated",
  "none",
]);
const KNOWN_OPTIONS = new Set([
  "style",
  "packageJson",
  "date",
  "year",
  "name",
  "version",
  "author",
  "license",
  "preserveExisting",
]);

function fail(message) {
  throw new Error(`${PREFIX}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Keeps metadata safe inside a block comment: line breaks become spaces,
// a premature comment terminator is broken up, and whitespace runs collapse
// so identical inputs format identically.
function sanitize(value) {
  return String(value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\*\//g, "* /")
    .replace(/\s+/g, " ")
    .trim();
}

function optionalString(value) {
  return typeof value === "string" ? value : "";
}

function authorOf(value) {
  if (typeof value === "string") return value;
  // npm allows {"name": ..., "email": ..., "url": ...}; only the name is
  // banner material, and an author object without a name counts as missing.
  if (isObject(value) && typeof value.name === "string") return value.name;
  return "";
}

function validateOptions(options) {
  if (options === undefined) options = {};
  if (!isObject(options)) fail("options must be an object");

  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) fail(`unknown option "${key}"`);
  }
  const get = (key) => options[key];

  let style = get("style");
  if (style === undefined) style = "long";
  if (typeof style !== "string" || !STYLES.has(style)) {
    const list = [...STYLES].join(", ");
    fail(`invalid style ${JSON.stringify(style)}; expected one of: ${list}`);
  }

  let packageJson = get("packageJson");
  if (packageJson === undefined) packageJson = DEFAULT_PACKAGE_JSON;
  if (typeof packageJson !== "string" || packageJson === "") {
    fail("packageJson must be a non-empty string");
  }

  let date = get("date");
  if (date === undefined) date = false;
  if (typeof date !== "boolean" && typeof date !== "string") {
    fail("date must be a boolean or a date string");
  }

  let year = get("year");
  if (year === undefined) year = String(new Date().getFullYear());
  if (typeof year === "number") {
    if (!Number.isFinite(year)) fail("year must be a finite number or a string");
    year = String(year);
  } else if (typeof year !== "string") {
    fail("year must be a number or a string");
  }

  let preserveExisting = get("preserveExisting");
  if (preserveExisting === undefined) preserveExisting = false;
  if (typeof preserveExisting !== "boolean") {
    fail("preserveExisting must be a boolean");
  }

  const overrides = {};
  for (const key of ["name", "version", "author", "license"]) {
    const value = get(key);
    if (value === undefined) continue;
    if (typeof value !== "string") fail(`${key} must be a string`);
    overrides[key] = value;
  }

  return { style, packageJson, date, year, preserveExisting, overrides };
}

// Reads the metadata file exactly once per banner() call. Relative paths
// resolve against process.cwd(), which is the configuration file's own
// directory when Guchho evaluates a config, never the plugin's install path.
function loadMetadata(packageJson) {
  const resolved = path.resolve(packageJson);

  let text;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch (error) {
    fail(`cannot read package metadata at ${resolved} (${error.code ?? error.message})`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    fail(`package metadata at ${resolved} is not valid JSON (${error.message})`);
  }

  if (!isObject(data)) fail(`package metadata at ${resolved} must be a JSON object`);
  return data;
}

function copyrightText(author, year) {
  const parts = ["Copyright (c)"];
  const y = sanitize(year);
  const a = sanitize(author);
  if (y) parts.push(y);
  if (a) parts.push(a);
  return parts.length > 1 ? parts.join(" ") : "";
}

// "GPL-3.0" becomes "GPL-3.0 License"; a value that already reads as one
// (e.g. "MIT License") is not suffixed again.
function licenseReference(license) {
  const value = sanitize(license);
  if (!value) return "";
  return /license$/i.test(value) ? value : `${value} License`;
}

// Resolves the date text from the date option: false → empty, true → today
// (UTC), a string → that exact value (sanitized).
function resolveDateText(date) {
  if (date === true) return new Date().toISOString().slice(0, 10);
  if (typeof date === "string") return sanitize(date);
  return "";
}

function multiline(lines) {
  const body = lines
    .filter((l) => l !== undefined && l !== null && l !== false)
    .map((l) => (l === "" ? " *" : ` * ${l}`));
  if (!body.length) return "/*! */";
  return `/*!\n${body.join("\n")}\n */`;
}

function singleLine(segments) {
  const line = segments.filter(Boolean).join(" | ");
  return line ? `/*! ${line} */` : "/*! */";
}

const STYLE_BUILDERS = {
  minimal(head) {
    return singleLine([head]);
  },

  version(head) {
    return singleLine([head]);
  },

  short(head, copyright, licenseRef, dateText) {
    const segments = [head, copyright, licenseRef];
    if (dateText) segments.push(`Built ${dateText}`);
    return singleLine(segments);
  },

  compact(head, copyright, licenseRef) {
    const info = head && licenseRef ? `${head} | ${licenseRef}` : head || licenseRef || undefined;
    return multiline([info, copyright || undefined]);
  },

  standard(head, copyright, licenseRef) {
    return multiline([
      head || undefined,
      copyright || undefined,
      licenseRef ? `License: ${licenseRef.replace(/ License$/i, "")}` : undefined,
    ]);
  },

  long(head, copyright, licenseRef, dateText) {
    const lines = [];
    if (head) lines.push(head);
    if (copyright) lines.push(copyright);
    if (licenseRef) {
      if (lines.length) lines.push("");
      lines.push(`Released under the ${licenseRef}`);
    }
    if (dateText) {
      if (lines.length) lines.push("");
      lines.push(`Built ${dateText}`);
    }
    return multiline(lines);
  },

  production(head, copyright, licenseRef) {
    return multiline([
      head || undefined,
      copyright || undefined,
      licenseRef ? `Licensed under the ${licenseRef}.` : undefined,
    ]);
  },

  full(head, copyright, licenseRef, dateText, meta) {
    const lines = [];
    if (meta.name) lines.push(`Package: ${meta.name}`);
    if (meta.version) lines.push(`Version: ${meta.version}`);
    if (meta.description) lines.push(`Description: ${meta.description}`);
    if (meta.author) lines.push(`Author: ${meta.author}`);
    if (meta.contributors) lines.push(`Contributors: ${meta.contributors}`);
    if (copyright) lines.push(copyright);
    if (licenseRef) lines.push(`License: ${licenseRef.replace(/ License$/i, "")}`);
    if (meta.homepage) lines.push(`Homepage: ${meta.homepage}`);
    if (meta.repository) lines.push(`Repository: ${meta.repository}`);
    if (dateText) lines.push(`Date: ${dateText}`);
    return multiline(lines);
  },

  legal(head, copyright, licenseRef) {
    const lines = [head, copyright];
    if (licenseRef) {
      if (lines.length) lines.push("");
      lines.push(`Licensed under the ${licenseRef}.`);
      lines.push("See the LICENSE file for details.");
    }
    return multiline(lines);
  },

  license(head, _copyright, licenseRef) {
    return singleLine([head, licenseRef && `Released under the ${licenseRef}`]);
  },

  author(head, _copyright, _licenseRef, _dateText, meta) {
    return singleLine([head, meta.author && `By ${meta.author}`]);
  },

  dated(head, copyright, licenseRef, dateText) {
    const lines = [head, copyright];
    if (licenseRef) lines.push(`License: ${licenseRef.replace(/ License$/i, "")}`);
    if (dateText) lines.push(`Date: ${dateText}`);
    return multiline(lines);
  },

  boxed(head, copyright, licenseRef) {
    const sep = "=================================";
    return multiline([
      sep,
      head || undefined,
      copyright || undefined,
      licenseRef ? `License: ${licenseRef.replace(/ License$/i, "")}` : undefined,
      sep,
    ]);
  },

  separated(head, copyright, licenseRef) {
    const lines = [head, "---------------------------------", copyright];
    if (licenseRef) lines.push(`License: ${licenseRef.replace(/ License$/i, "")}`);
    return multiline(lines);
  },

  none() {
    return "";
  },
};

// Renders the banner text from validated options and the metadata file. This is
// the pure part of the plugin, separated so tests can drive the styles without a
// bundle in hand. Reading happens here — exactly once per call — which the
// plugin defers to its buildStart hook so errors travel as plugin diagnostics.
function renderFromOptions(opts) {
  const data = loadMetadata(opts.packageJson);

  const name = sanitize(
    opts.overrides.name !== undefined ? opts.overrides.name : optionalString(data.name),
  );
  const rawVersion = sanitize(
    opts.overrides.version !== undefined ? opts.overrides.version : optionalString(data.version),
  );
  let version = rawVersion;
  if (version && !/^v/i.test(version)) version = `v${version}`;
  const author = sanitize(
    opts.overrides.author !== undefined ? opts.overrides.author : authorOf(data.author),
  );
  const license = sanitize(
    opts.overrides.license !== undefined ? opts.overrides.license : optionalString(data.license),
  );

  const head = [name, version].filter(Boolean).join(" ");
  const copyright = copyrightText(author, opts.year);
  const licenseRef = licenseReference(license);
  const dateText = resolveDateText(opts.date);

  const meta = {
    name,
    version: rawVersion,
    description: sanitize(optionalString(data.description)),
    author,
    contributors: sanitize(
      Array.isArray(data.contributors)
        ? data.contributors.map(authorOf).filter(Boolean).join(", ")
        : optionalString(data.contributors),
    ),
    license,
    homepage: sanitize(optionalString(data.homepage)),
    repository: sanitize(
      isObject(data.repository)
        ? optionalString(data.repository.url)
        : optionalString(data.repository),
    ),
  };

  const build = STYLE_BUILDERS[opts.style];
  return build(head, copyright, licenseRef, dateText, meta);
}

// Renders the banner text for a user-facing options object: validates the
// options first, then reads the metadata and formats the result.
export function renderBanner(options) {
  return renderFromOptions(validateOptions(options));
}

// Files that get the banner. Chunks are every JavaScript-like output the engine
// emits; CSS reaches generateBundle as an asset, so it is matched by name. Maps,
// JSON, HTML and binary assets are left alone, and the legal-comment form is
// what preserveExisting looks for before injecting.
const CSS_OUTPUT = /\.css$/i;
const LEGAL_BANNER = /^\s*\/\*!/;

function prepend(text, source) {
  const body = String(source);
  if (!text) return body;
  if (!body) return text;
  return `${text}\n${body}`;
}

// Adds a leading banner to one output. Returns false when the output already
// carries a legal banner and preserveExisting says to keep it.
function bannerOne(text, output, preserveExisting) {
  const source = output.type === "asset" ? String(output.source) : String(output.code);
  if (preserveExisting && LEGAL_BANNER.test(source)) return;
  if (output.type === "asset") output.source = prepend(text, output.source);
  else output.code = prepend(text, output.code);
}

// The plugin. banner() validates its options immediately — a typo fails the
// config before a build starts — and defers the metadata read to buildStart so
// a missing package.json is a plugin diagnostic on the build rather than a
// crash in the host. generateBundle rewrites every eligible output in place.
export default function banner(options) {
  const opts = validateOptions(options);
  let state = null;

  const buildState = (context) => {
    if (state !== null) return state;
    try {
      state = { text: renderFromOptions(opts), preserveExisting: opts.preserveExisting };
    } catch (error) {
      context.error(error);
    }
    return state;
  };

  return {
    name: PREFIX,

    buildStart() {
      buildState(this);
    },

    generateBundle(_options, bundle) {
      const built = buildState(this);
      if (!built.text) return;
      for (const output of Object.values(bundle)) {
        if (output === null || typeof output !== "object") continue;
        if (output.type === "chunk") {
          bannerOne(built.text, output, built.preserveExisting);
        } else if (output.type === "asset" && CSS_OUTPUT.test(output.fileName)) {
          bannerOne(built.text, output, built.preserveExisting);
        }
      }
    },
  };
}