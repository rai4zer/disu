/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep dev and validation builds isolated when NEXT_DIST_DIR is provided.
  distDir: process.env.NEXT_DIST_DIR || ".next"
};

export default nextConfig;
