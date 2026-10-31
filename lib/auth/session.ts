import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";

export type RequestAuth = {
  userId: string;
  isAdmin: boolean;
  email: string;
  name: string;
  imageUrl: string;
};

function adminIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function getRequestAuth(): Promise<RequestAuth | null> {
  const session = await auth();
  if (!session.userId) return null;

  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  const isAdmin = role === "admin" || adminIds().includes(session.userId);

  return {
    userId: session.userId,
    isAdmin,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    name: user?.fullName || user?.username || "",
    imageUrl: user?.imageUrl ?? "",
  };
}

export async function requireAdmin(): Promise<RequestAuth> {
  const actor = await getRequestAuth();
  if (!actor) {
    throw new Response(JSON.stringify({ error: { code: "unauthorized", message: "Sign in to continue" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (!actor.isAdmin) {
    throw new Response(JSON.stringify({ error: { code: "forbidden", message: "Administrator access is required" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return actor;
}
