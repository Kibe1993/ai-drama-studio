import { getRequestAuth } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { upsertStudioUser } from "@/lib/repositories/userRepository";

export const dynamic = "force-dynamic";

export default async function AssistantLayout({ children }: { children: React.ReactNode }) {
  const actor = await getRequestAuth();
  if (!actor) redirect("/sign-in");
  await upsertStudioUser(actor);
  return <>{children}</>;
}