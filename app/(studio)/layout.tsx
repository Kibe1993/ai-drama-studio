import { redirect } from "next/navigation";
import { getRequestAuth } from "@/lib/auth/session";
import { upsertStudioUser } from "@/lib/repositories/userRepository";
import { StudioShell } from "@/components/layout/StudioShell";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const actor = await getRequestAuth();
  if (!actor) redirect("/sign-in");
  await upsertStudioUser(actor);
  return <StudioShell>{children}</StudioShell>;
}
