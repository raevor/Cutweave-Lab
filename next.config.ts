import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [...["/lab/anime-face-recognition", "/lab/clarity-boost"].map(source=>({
      source,
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      ],
    })), ...["/_next/static/:path*", "/wasm/:path*"].map(source=>({
      source,
      headers:[
        {key:"Cross-Origin-Embedder-Policy",value:"require-corp"},
        {key:"Cross-Origin-Resource-Policy",value:"same-origin"},
      ],
    }))];
  },
};

export default nextConfig;
