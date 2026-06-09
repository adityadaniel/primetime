/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
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
