/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // The local dev server is commonly accessed through the Cloudflare tunnel
  // during iPhone/Safari QA. Next.js 15 warns today — and will block in a
  // future major — unless that public dev origin is explicitly allowed for
  // /_next/* assets and HMR requests.
  allowedDevOrigins: ['live.theprimetime.id'],
  images: {
    // Serve modern formats for quiz stills (uploaded under /uploads). AVIF/WebP
    // are far smaller than the source PNG/JPEG, which matters most in tunnel
    // mode where delivery is capped by the host's upstream bandwidth. SVG is
    // left unoptimized per-image at the call site rather than via
    // dangerouslyAllowSVG, to avoid serving untrusted SVG inline.
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
