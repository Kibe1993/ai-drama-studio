"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { StoryDraftWorkspace } from "@/components/workflow/StoryDraftWorkspace";
import { ImportDialog } from "@/components/projects/ImportDialog";
import { ExportDialog } from "@/components/projects/ExportDialog";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProjects";

export default function StoryDraftPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);

  async function handleImport(_content: string, _format: "markdown" | "json" | "text") {
    setShowImport(false);
  }

  return (
    <StageLayout projectId={projectId} stage="story">
      {project ? (
        <>
          <div className="mb-4 flex gap-2">
            <Button variant="quiet" size="sm" onClick={() => setShowImport(true)}>Import</Button>
            <Button variant="quiet" size="sm" onClick={() => setShowExport(true)}>Export</Button>
          </div>
          <StoryDraftWorkspace project={project} />
          <ImportDialog
            open={showImport}
            onClose={() => setShowImport(false)}
            onImport={handleImport}
            title="Import Story"
          />
          <ExportDialog
            open={showExport}
            onClose={() => setShowExport(false)}
            data={project}
            title="Export Story"
          />
        </>
      ) : null}
    </StageLayout>
  );
}
