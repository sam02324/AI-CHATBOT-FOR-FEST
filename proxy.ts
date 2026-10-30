import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isSignInOrUp = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApi = createRouteMatcher(["/api(.*)"]);

// Pages redirect signed-out visitors to sign in. API routes check access themselves and return errors.
export default clerkMiddleware(
  async (auth, request) => {
    if (!isSignInOrUp(request) && !isApi(request)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
