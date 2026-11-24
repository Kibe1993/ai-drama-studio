"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { STATUS_LABELS, PROJECT_STATUSES } from "@/lib/domain/projectCatalog";
import { ProjectRows } from "@/components/projects/ProjectRows";
import { Button } from "@/components/ui/button";
import { useSummary } from "@/hooks/useProjects";
import { Plus, Film, ArrowRight } from "lucide-react";

export default function DashboardPage() {
  const { user } = useUser();
  const summary = useSummary();
  const name = user?.firstName || "there";

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase">Studio</p>
      <h1 className="font-display mt-2 text-5xl leading-tight">Welcome, {name}</h1>
      <p className="mt-4 max-w-xl text-[#cfc6b8] leading-relaxed">
        Start a short drama from a story idea. The screenplay, characters, and video stages come later.
        Projects you save now stay on this account.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/projects/new" className="inline-flex items-center gap-2">
            <Plus size={16} strokeWidth={2} />
            Create new drama
          </Link>
        </Button>
        <Button asChild variant="quiet">
          <Link href="/mcp" className="inline-flex items-center gap-2">
            Connect AI Assistant
            <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </Button>
      </div>

      {summary.isLoading ? (
        <p className="mt-12 text-[#a39b8f]">Loading your studio…</p>
      ) : null}
      {summary.isError ? (
        <p className="mt-12 text-[#e7b2a8]">Projects could not be loaded.</p>
      ) : null}

      {summary.data ? (
        <>
          <section className="mt-14">
            <h2 className="text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Production status</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PROJECT_STATUSES.map((status) => (
                <div
                  key={status}
                  className="rounded-xl border border-[#2e2a25] bg-[#181612] px-5 py-4"
                >
                  <div className="text-sm text-[#a39b8f]">{STATUS_LABELS[status]}</div>
                  <div className="font-display mt-1 text-3xl text-[#f3efe6]">
                    {summary.data.counts[status]}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-14">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Recent projects</h2>
              <Link href="/projects" className="text-sm text-[#c4a574] transition-colors hover:text-[#d4b784]">
                All projects →
              </Link>
            </div>
            <ProjectRows projects={summary.data.recent} />
          </section>

          <section className="mt-14">
            <h2 className="mb-3 text-sm tracking-[0.14em] text-[#a39b8f] uppercase">
              Completed videos
            </h2>
            {summary.data.completed.length === 0 ? (
              <div className="rounded-xl border border-[#2e2a25] bg-[#181612] px-6 py-10 text-center">
                <Film size={32} strokeWidth={1.5} className="mx-auto text-[#6b6258]" />
                <p className="mt-3 text-[#a39b8f]">
                  No finished videos yet. Rendering is not connected in this release.
                </p>
              </div>
            ) : (
              <ProjectRows projects={summary.data.completed} />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
