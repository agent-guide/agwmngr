import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  webpack(config, { dir }) {
    config.resolve.modules = [path.join(dir, "node_modules"), ...config.resolve.modules];
    return config;
  },
};

export default nextConfig;
