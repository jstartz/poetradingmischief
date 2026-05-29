/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cache upstream API responses at the edge
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "s-maxage=120, stale-while-revalidate=600" }],
      },
    ];
  },
};
export default nextConfig;
