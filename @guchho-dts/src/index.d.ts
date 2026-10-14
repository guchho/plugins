import type { Plugin } from "guchho";

export interface DtsPluginOptions {
  /**
   * One entry, or several. Required. A path is resolved against the build's
   * working directory and must name a TypeScript file. A source file
   * (".ts"/".tsx"/".mts"/".cts") is compiled to declarations before it is
   * bundled; a ".d.ts" is bundled as is.
   */
  entry: string | string[];
  /**
   * The path of the single bundled declaration file, e.g. "dist/index.d.ts".
   * Mutually exclusive with `dir`, and only valid with one entry.
   */
  outfile?: string;
  /**
   * A directory to collect one bundled declaration file per entry in. Mutually
   * exclusive with `outfile`.
   */
  dir?: string;
  /** A tsconfig path, relative to the build's working directory. */
  tsconfig?: string;
  /** Compiler options layered over the tsconfig before the program is built. */
  compilerOptions?: Record<string, unknown>;
  /**
   * Leave imports of installed packages as imports instead of inlining them.
   * Defaults to `true`.
   */
  respectExternal?: boolean;
  /** Package names to inline even though they live in node_modules. */
  includeExternal?: string[];
  /**
   * Reserved. Declaration source maps are not emitted yet; the option is
   * accepted so a configuration can set it, and a warning is raised.
   */
  sourcemap?: boolean;
}

/**
 * Bundles TypeScript declaration files into one flat module per entry and emits
 * each as a Guchho build asset.
 */
// A declaration bundler for Guchho. It builds a TypeScript program over the
// given entry (or entries), inlines every local module they reach, leaves
// external packages as imports, renames colliding declarations, and emits one
// flat module per entry as a build asset. A source entry is compiled to
// declarations in memory first, so an implementation file needs no separate
// "tsc" step.
export function dts(options: DtsPluginOptions): Plugin;

export default dts;
