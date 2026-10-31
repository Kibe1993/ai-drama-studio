import { redirect } from "next/navigation";
import { getRequestAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getRequestAuth();
  if (!actor) redirect("/sign-in");
  if (!actor.isAdmin) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="font-display text-4xl">Administration</h1>
        <p className="mt-4 text-[#cfc6b8]">This account does not have administrator access.</p>
      </main>
    );
  }
  return <main className="mx-auto max-w-3xl px-6 py-16">{children}</main>;
}
