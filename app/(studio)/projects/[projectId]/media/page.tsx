"use client";

import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { MediaGallery } from "@/components/media/MediaGallery";

export default function MediaPage() {
  const params = useParams<{ projectId: string }>();
  return (
    <div>
      <ProjectHeader projectId={params.projectId} />
      <MediaGallery projectId={params.projectId} />
    </div>
  );
}