import banner from "@guchho/banner";

export default {
  build: {
    entry: ["src/main.js", "src/styles.css"],
    outdir: "dist",
    format: "esm",
    minify: true,
    sourcemap: true,
  },
  plugins: [
    banner({
      style: "long",
      packageJson: "./package.json",
    }),
  ],
};
