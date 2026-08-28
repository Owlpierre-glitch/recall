import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The memory layer is plain SQL over the postgres driver. Nothing to bundle
  // for the browser, so the driver stays server side only.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
