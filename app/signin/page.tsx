import SignInClient from "./SignInClient";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const enableApple = process.env.ENABLE_APPLE_SIGNIN === "true";
  return <SignInClient enableApple={enableApple} />;
}
