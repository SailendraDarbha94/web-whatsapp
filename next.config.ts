import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Nothing here uses next/image, so switch off the /_next/image optimizer
    // endpoint (`next start` answers it with 404). It has been the target of
    // several Next.js security advisories, and an unused endpoint is one less
    // thing to patch.
    unoptimized: true,
  },
};

export default nextConfig;
