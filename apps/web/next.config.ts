import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@anyterm/utils", "@anyterm/db"],
  output: "standalone",
  rewrites: async () => {
    const wsBase = process.env.WS_SERVER_URL || `http://localhost:${process.env.WS_PORT || 3001}`;
    return [
      {
        source: "/ws",
        destination: `${wsBase}/ws`,
      },
      {
        source: "/tunnel/:path*",
        destination: `${wsBase}/tunnel/:path*`,
      },
    ];
  },
  headers: async () => [
    {
      // Tunnel responses must be embeddable in our preview iframe
      source: "/tunnel/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
    {
      source: "/((?!tunnel/).*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-DNS-Prefetch-Control", value: "on" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline' 'unsafe-eval'${process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ? " https://cloud.umami.is" : ""}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            `connect-src 'self'${process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ? " https://cloud.umami.is https://api-gateway.umami.dev" : ""} ${process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001"} ${process.env.NEXT_PUBLIC_WS_URL?.replace("ws", "http") || "http://localhost:3001"} ${process.env.NEXT_PUBLIC_PREVIEW_ORIGIN || ""}`.trim(),
            `frame-src 'self' ${process.env.NEXT_PUBLIC_PREVIEW_ORIGIN || ""}`.trim(),
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ],
    },
  ],
};

export default nextConfig;
