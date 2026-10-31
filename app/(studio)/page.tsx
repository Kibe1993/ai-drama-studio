"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { STATUS_LABELS, PROJECT_STATUSES } from "@/lib/domain/projectCatalog";
import { ProjectRows } from "@/components/projects/ProjectRows";
import { Button } from "@/components/ui/button";
import { useSummary } from "@/hooks/useProjects";

export default function DashboardPage() {
  const { user } = useUser();
  const summary = useSummary();
  const name = user?.firstName || "there";

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase">Studio</p>
      <h1 className="font-display mt-2 text-5xl leading-tight">Welcome, {name}</h1>
      <p className="mt-4 max-w-xl text-[#cfc6b8]">
        Start a short drama from a story idea. The screenplay, characters, and video stages come later. Projects you save now stay on this account.
      </p>
      <div className="mt-8">
        <Button asChild>
          <Link href="/projects/new">Create new drama</Link>
        </Button>
      </div>

      {summary.isLoading ? <p className="mt-12 text-[#a39b8f]">Loading your studio</p> : null}
      {summary.isError ? <p className="mt-12 text-[#e7b2a8]">Projects could not be loaded.</p> : null}

      {summary.data ? (
        <>
          <section className="mt-14">
            <h2 className="text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Production status</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {PROJECT_STATUSES.map((status) => (
                <div key={status}>
                  <dt className="text-sm text-[#a39b8f]">{STATUS_LABELS[status]}</dt>
                  <dd className="text-2xl text-[#f3efe6]">{summary.data.counts[status]}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="mt-14">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Recent projects</h2>
              <Link href="/projects" className="text-sm text-[#c4a574]">
                All projects
              </Link>
            </div>
            <ProjectRows projects={summary.data.recent} />
          </section>
          <section className="mt-14">
            <h2 className="mb-3 text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Completed videos</h2>
            {summary.data.completed.length === 0 ? (
              <p className="text-[#a39b8f]">No finished videos yet. Rendering is not connected in this release.</p>
            ) : (
              <ProjectRows projects={summary.data.completed} />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
