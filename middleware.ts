import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (
    !process.env.CLERK_SECRET_KEY ||
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ) {
    return;
  }

  const pathname = request.nextUrl.pathname;

  if (isPublicRoute(request)) return;

  // Allow MCP authentication metadata to be discovered publicly.
  if (
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-protected-resource/api/mcp"
  ) {
    return;
  }

  // MCP validates its own Bearer token in app/api/mcp/route.ts.
  // Do not ask Clerk to interpret this custom token as a JWT.
  if (
    pathname === "/api/mcp" &&
    request.headers.get("authorization")?.startsWith("Bearer ")
  ) {
    return;
  }

  const { userId } = await auth();
  if (userId) return;

  if (pathname.startsWith("/api/")) {
    log.info("api", `${request.method} ${pathname} -> 401`, {
      reason: "signed_out",
    });

    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Sign in to continue",
        },
      },
      { status: 401 },
    );
  }

  const signIn = new URL("/sign-in", request.url);

  signIn.searchParams.set(
    "redirect_url",
    `${pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(signIn);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
