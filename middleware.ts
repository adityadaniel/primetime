export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/host/:path*",
    "/api/quiz/:path*",
    "/api/stripe/:path*",
  ],
};
