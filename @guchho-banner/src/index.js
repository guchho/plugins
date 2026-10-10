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

export default function banner(options) {
  const opts = validateOptions(options);
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
  const text = build(head, copyright, licenseRef, dateText, meta);

  return {
    name: PREFIX,
    banner: { js: text, css: text },
    preserveExisting: opts.preserveExisting,
  };
}
