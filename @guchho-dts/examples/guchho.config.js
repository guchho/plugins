import dts from "@guchho/dts";

export default {
  build: {
    entry: "src/index.js",
    outdir: "dist",
    format: "esm",
  },
  plugins: [
    dts({
      entry: "dist/types/index.d.ts",
      outfile: "dist/index.d.ts",
    }),
  ],
};
