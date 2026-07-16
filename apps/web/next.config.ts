import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Serve the self-contained CROO Demo Day deck (public/pitch.html) at a clean
  // /pitch URL. It is a full-bleed standalone document, deliberately bypassing
  // the site Chrome/layout — hence a static file + rewrite, not an app route.
  async rewrites() {
    return [{ source: "/pitch", destination: "/pitch.html" }];
  },
};

export default nextConfig;
