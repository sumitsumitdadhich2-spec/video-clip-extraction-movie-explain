/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The cloned voice library lives in the repo, so the audio files must be
  // bundled with the API routes that read them on a deployment.
  outputFileTracingIncludes: {
    "/api/voices/**": ["./data/voices/**/*"],
  },
  async headers() {
    return [
      {
        // Cross-origin isolation enables SharedArrayBuffer, which lets the
        // merge tool use the MULTI-THREADED ffmpeg engine (4-6x faster
        // conversion using all CPU cores).
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
}

export default nextConfig
