import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  // pdf-parse's pdfjs-dist dependency dynamically imports its own worker
  // script (pdf.worker.mjs) by a path relative to its own module location.
  // Next's bundler relocates/renames files into content-hashed chunks,
  // breaking that relative import ("Setting up fake worker failed: Cannot
  // find module '...pdf.worker.mjs'"). Marking the package external leaves
  // it untouched by the bundler so Node's normal module resolution finds
  // the real file at its real node_modules path at runtime. This is a
  // bundler-integration setting only -- it does not change what
  // text-extraction.ts calls or how it behaves.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
