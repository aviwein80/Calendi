import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [{ source: "/admin", destination: "/admin/event-types", permanent: false }];
  },
  async headers() {
    return [
      {
        // The admin must never be shown inside another site's frame.
        source: "/admin/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // Booking links carry a private token; do not leak it to other sites.
        source: "/booking/:path*",
        headers: [{ key: "Referrer-Policy", value: "same-origin" }],
      },
    ];
  },
};

export default nextConfig;
