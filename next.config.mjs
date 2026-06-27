/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cedar ships as a WebAssembly module. Keep it external to the server bundle so
  // Next/webpack does not try to inline the .wasm, and enable async WASM loading.
  serverExternalPackages: ["@cedar-policy/cedar-wasm"],
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
