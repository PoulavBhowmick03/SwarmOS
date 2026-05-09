import type { NextConfig } from "next";
import webpack from "webpack";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../'),
  webpack: (config, { isServer }) => {
    // Solana / Anchor browser polyfills
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        os: false,
        path: false,
        stream: false,
        net: false,
        tls: false,
      };
      config.plugins.push(
        new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] })
      );
    }
    return config;
  },
};

export default nextConfig;
