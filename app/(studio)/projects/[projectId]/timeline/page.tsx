"use client";

import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { TimelineEditor } from "@/components/timeline/TimelineEditor";

export default function TimelinePage() {
  const params = useParams<{ projectId: string }>();
  return (
    <div>
      <ProjectHeader projectId={params.projectId} />
      <TimelineEditor projectId={params.projectId} />
    </div>
  );
}