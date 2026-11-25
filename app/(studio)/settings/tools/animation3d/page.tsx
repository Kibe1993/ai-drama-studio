"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";

type ToolConfig = { id: string; toolType: string; displayName: string; enabled: boolean; status: string };
type MixamoAnimation = { id: string; name: string; category: string; description?: string };

export default function Animation3DPage() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [animations, setAnimations] = useState<MixamoAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [modelParams, setModelParams] = useState('{"gender": "male", "height": 180, "outputPath": "output_model"}');
  const [rigPath, setRigPath] = useState("");
  const [blendFile, setBlendFile] = useState("");

  useEffect(() => {
    let active = true;
    api<{ tools: ToolConfig[]; animations: MixamoAnimation[] }>("/api/tools/animation3d")
      .then((data) => { if (active) { setTools(data.tools); setAnimations(data.animations); } })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Failed to load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const runAction = useCallback(async (action: string, body: Record<string, unknown>) => {
    setActionLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api<Record<string, unknown>>("/api/tools/animation3d", { method: "POST", body: JSON.stringify({ action, ...body }) });
      setResult(res);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }, []);

  if (loading) return <div className="text-[#a39b8f] mt-8">Loading 3D animation tools…</div>;

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase mt-6">3D Animation</p>
      <h1 className="font-display mt-2 text-4xl">3D Character Pipeline</h1>
      <p className="mt-4 text-[#a39b8f] leading-relaxed">
        Generate 3D character models with MakeHuman, add rigs and animations from Mixamo, and render with Blender.
      </p>

      {error ? <p className="text-red-400 mt-4">{error}</p> : null}

      <div className="mt-6 grid gap-4">
        {tools.map((tool) => (
          <div key={tool.id} className="rounded border border-[#2a2620] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-[#f3efe6]">{tool.displayName}</p>
                <p className="text-xs text-[#a39b8f]">{tool.toolType} — {tool.enabled ? tool.status : "disabled"}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="font-display text-xl text-[#f3efe6]">MakeHuman — Generate Model</h2>
        <p className="text-sm text-[#a39b8f] mt-1">Generate a 3D character model with parameters.</p>
        <textarea
          className="studio-field mt-2 font-mono"
          rows={3}
          value={modelParams}
          onChange={(e) => setModelParams(e.target.value)}
        />
        <button
          className="mt-2 rounded border border-[#c4a574] px-4 py-2 text-sm text-[#c4a574] hover:bg-[rgba(196,165,116,0.1)] disabled:opacity-50"
          onClick={() => runAction("generate_model", { params: JSON.parse(modelParams) })}
          disabled={actionLoading}
        >
          {actionLoading ? "Working…" : "Generate model"}
        </button>
      </div>

      <div className="mt-8">
        <h2 className="font-display text-xl text-[#f3efe6]">Mixamo — Import Rig/Animation</h2>
        <p className="text-sm text-[#a39b8f] mt-1">Download rigs/animations from Mixamo (web), then import the FBX file.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {animations.map((anim) => (
            <div key={anim.id} className="rounded border border-[#2a2620] p-2 text-sm">
              <span className="text-[#f3efe6]">{anim.name}</span>
              <span className="text-[#a39b8f] ml-2">({anim.category})</span>
            </div>
          ))}
        </div>
        <input
          className="studio-field mt-3"
          placeholder="Path to downloaded FBX file"
          value={rigPath}
          onChange={(e) => setRigPath(e.target.value)}
        />
        <button
          className="mt-2 rounded border border-[#c4a574] px-4 py-2 text-sm text-[#c4a574] hover:bg-[rgba(196,165,116,0.1)] disabled:opacity-50"
          onClick={() => runAction("import_rig", { filePath: rigPath })}
          disabled={actionLoading || !rigPath}
        >
          Import rig
        </button>
      </div>

      <div className="mt-8">
        <h2 className="font-display text-xl text-[#f3efe6]">Blender — Render Animation</h2>
        <p className="text-sm text-[#a39b8f] mt-1">Render a 3D animation from a Blender project file.</p>
        <input
          className="studio-field mt-2"
          placeholder="/path/to/project.blend"
          value={blendFile}
          onChange={(e) => setBlendFile(e.target.value)}
        />
        <button
          className="mt-2 rounded border border-[#c4a574] px-4 py-2 text-sm text-[#c4a574] hover:bg-[rgba(196,165,116,0.1)] disabled:opacity-50"
          onClick={() => runAction("render", { params: { projectFile: blendFile } })}
          disabled={actionLoading || !blendFile}
        >
          {actionLoading ? "Rendering…" : "Render"}
        </button>
      </div>

      {result ? (
        <div className="mt-6 rounded border border-[#6bb36b] p-4">
          <pre className="text-sm text-[#cfc6b8]">{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}