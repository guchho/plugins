import fs from "node:fs";
import path from "node:path";

const PREFIX = "@guchho/banner";
const DEFAULT_PACKAGE_JSON = "./package.json";
const KNOWN_OPTIONS = new Set([
  "style",
  "packageJson",
  "date",
  "year",
  "name",
  "version",
  "author",
  "license",
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
  if (style !== "short" && style !== "long") {
    fail(`invalid style ${JSON.stringify(style)}; expected "short" or "long"`);
  }

  let packageJson = get("packageJson");
  if (packageJson === undefined) packageJson = DEFAULT_PACKAGE_JSON;
  if (typeof packageJson !== "string" || packageJson === "") {
    fail("packageJson must be a non-empty string");
  }

  let date = get("date");
  if (date === undefined) date = false;
  if (typeof date !== "boolean") fail("date must be a boolean");

  let year = get("year");
  if (year === undefined) year = String(new Date().getFullYear());
  if (typeof year === "number") {
    if (!Number.isFinite(year)) fail("year must be a finite number or a string");
    year = String(year);
  } else if (typeof year !== "string") {
    fail("year must be a number or a string");
  }

  const overrides = {};
  for (const key of ["name", "version", "author", "license"]) {
    const value = get(key);
    if (value === undefined) continue;
    if (typeof value !== "string") fail(`${key} must be a string`);
    overrides[key] = value;
  }

  return { style, packageJson, date, year, overrides };
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

function buildBanner(style, head, copyright, licenseRef, dateText) {
  if (style === "short") {
    const segments = [head, copyright, licenseRef];
    if (dateText) segments.push(`Built ${dateText}`);
    const line = segments.filter(Boolean).join(" | ");
    return line ? `/*! ${line} */` : "/*! */";
  }

  const lines = [];
  if (head) lines.push(` * ${head}`);
  if (copyright) lines.push(` * ${copyright}`);
  if (licenseRef) {
    if (lines.length) lines.push(" *");
    lines.push(` * Released under the ${licenseRef}`);
  }
  if (dateText) {
    if (lines.length) lines.push(" *");
    lines.push(` * Built ${dateText}`);
  }
  if (!lines.length) return "/*! */";
  return `/*!\n${lines.join("\n")}\n */`;
}

export default function banner(options) {
  const opts = validateOptions(options);
  const data = loadMetadata(opts.packageJson);

  const name = sanitize(
    opts.overrides.name !== undefined ? opts.overrides.name : optionalString(data.name),
  );
  let version = sanitize(
    opts.overrides.version !== undefined ? opts.overrides.version : optionalString(data.version),
  );
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
  const dateText = opts.date ? new Date().toISOString().slice(0, 10) : "";

  const text = buildBanner(opts.style, head, copyright, licenseRef, dateText);

  return {
    name: PREFIX,
    banner: { js: text, css: text },
  };
}
