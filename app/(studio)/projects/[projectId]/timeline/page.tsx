"use client";

import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { TimelineEditor } from "@/components/timeline/TimelineEditor";

export default function TimelinePage() {
  const params = useParams<{ projectId: string }>();
  return (
    <StageLayout projectId={params.projectId} stage="timeline">
      <TimelineEditor projectId={params.projectId} />
    </StageLayout>
  );
}