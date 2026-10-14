import dts from "@guchho/dts";

// A Guchho library build: Guchho compiles src/index.ts to JavaScript, and
// @guchho/dts reads the same TypeScript source and emits dist/index.d.ts next to
// it. No separate `tsc --emitDeclarationOnly` step is needed.
export default {
  build: {
    entry: "src/index.ts",
    outdir: "dist",
    format: "esm",
  },
  plugins: [
    dts({
      entry: "src/index.ts",
      outfile: "dist/index.d.ts",
    }),
  ],
};
