import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.1.36",
    "192.168.1.*",
  ],
};

export default nextConfig;
