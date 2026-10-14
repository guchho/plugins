import type { Plugin } from "guchho";

export interface DtsPluginOptions {
  /**
   * One declaration entry, or several. Required. A path is resolved against the
   * build's working directory and must name a declaration file.
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
export function dts(options: DtsPluginOptions): Plugin;

export default dts;
