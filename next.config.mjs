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
  //
  // @napi-rs/canvas must be externalized alongside pdf-parse for the same
  // reason: pdfjs-dist's Node build (imported by pdf-parse) requires it at
  // module-evaluation time to polyfill DOMMatrix/ImageData/Path2D, and
  // Next's file tracer does not detect that dependency's dynamically
  // constructed require() call, so it was previously omitted from the
  // deployed serverless function (per pdf-parse's own troubleshooting
  // guide for Vercel/serverless deployments).
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // Frame-embedding policy (Phase 7, Increment 3, Task 3; AD-026). Exactly
  // one route -- /widget, the reserved iframe-hosted widget interface --
  // may be framed, and only by an HTTPS origin. The second source matches
  // every other terminal application route and denies framing entirely.
  // /widget/ (trailing slash) technically matches both raw source
  // patterns, but Next.js's own trailing-slash normalization issues a
  // framework-generated 308 redirect to /widget before either header set
  // is applied; that redirect carries neither custom header, and the
  // canonical /widget response it points to receives only the allow
  // policy. No terminal rendered response ever receives both the allow
  // and deny policies together.
  async headers() {
    return [
      {
        source: "/widget",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https:",
          },
        ],
      },
      {
        source: "/((?!widget$).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
