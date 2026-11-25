"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus, Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type TrackKind = "video" | "dialogue" | "narration" | "music" | "sfx" | "subtitle";

type Clip = {
  assetId: string;
  startSeconds: number;
  durationSeconds: number;
  audioOffsetSeconds: number;
  transition: string;
  optional: boolean;
  title: string;
  sceneNumber: number | null;
  shotNumber: number | null;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  volume: number;
};

type Track = { kind: TrackKind; clips: Clip[] };

type ValidationResult = {
  missingAssets: string[];
  overlaps: Record<string, unknown>[];
  brokenReferences: string[];
  durationMismatch: boolean;
  warnings: string[];
};

type Timeline = {
  id: string;
  status: "draft" | "under_review" | "approved" | "stale";
  tracks: Track[];
  aspectRatio: string;
  outputResolution: string;
  frameRate: number;
  episodeTargetDurationSeconds: number | null;
  validation: ValidationResult;
};

type Asset = {
  id: string;
  type: string;
  fileName: string;
  durationSeconds: number | null;
  storageKey: string;
};

type AvailableAssets = {
  video: Asset[];
  dialogue: Asset[];
  narration: Asset[];
  music: Asset[];
  sfx: Asset[];
  subtitle: Asset[];
};

type EditableTimeline = { timeline: Timeline | null; availableAssets: AvailableAssets };

const TRACK_KINDS: TrackKind[] = ["video", "dialogue", "narration", "music", "sfx", "subtitle"];
const TRACK_LABELS: Record<TrackKind, string> = {
  video: "Video",
  dialogue: "Dialogue",
  narration: "Narration",
  music: "Music",
  sfx: "SFX",
  subtitle: "Subtitle",
};
const TRANSITION_OPTIONS = ["", "fade", "wipeleft", "wiperight", "slideup", "slidedown"] as const;
const TRANSITION_LABELS: Record<string, string> = {
  "": "Cut",
  fade: "Crossfade",
  wipeleft: "Wipe Left",
  wiperight: "Wipe Right",
  slideup: "Slide Up",
  slidedown: "Slide Down",
};

function makeClip(asset: Asset, startSeconds: number): Clip {
  return {
    assetId: asset.id,
    startSeconds,
    durationSeconds: asset.durationSeconds ?? 5,
    audioOffsetSeconds: 0,
    transition: "",
    optional: false,
    title: asset.fileName,
    sceneNumber: null,
    shotNumber: null,
    trimStartSeconds: 0,
    trimEndSeconds: null,
    volume: 1,
  };
}

function SortableClip({
  clip,
  index,
  trackKind,
  onUpdate,
  onRemove,
}: {
  clip: Clip;
  index: number;
  trackKind: TrackKind;
  onUpdate: (patch: Partial<Clip>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.assetId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded border border-[#2a2620] bg-[#1a1714] p-2">
      <button {...attributes} {...listeners} className="cursor-grab text-[#a39b8f] hover:text-[#c4a574]">
        <GripVertical size={16} />
      </button>
      <span className="text-xs text-[#a39b8f]">#{index + 1}</span>
      <span className="truncate font-mono text-xs text-[#c4a574]" title={clip.title || clip.assetId}>
        {clip.title || clip.assetId.slice(0, 12)}
      </span>
      <div className="flex items-center gap-1 text-xs">
        <label className="text-[#a39b8f]">Start</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={clip.startSeconds.toFixed(1)}
          onChange={(e) => onUpdate({ startSeconds: parseFloat(e.target.value) || 0 })}
          className="w-16 rounded bg-[#0d0c0a] px-1 py-0.5 text-[#f3efe6]"
        />
      </div>
      <div className="flex items-center gap-1 text-xs">
        <label className="text-[#a39b8f]">Dur</label>
        <input
          type="number"
          step="0.1"
          min="0.1"
          value={clip.durationSeconds.toFixed(1)}
          onChange={(e) => onUpdate({ durationSeconds: parseFloat(e.target.value) || 0.1 })}
          className="w-16 rounded bg-[#0d0c0a] px-1 py-0.5 text-[#f3efe6]"
        />
      </div>
      {clip.volume !== 1 && (
        <div className="flex items-center gap-1 text-xs">
          <label className="text-[#a39b8f]">Vol</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={clip.volume.toFixed(1)}
            onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) || 0 })}
            className="w-14 rounded bg-[#0d0c0a] px-1 py-0.5 text-[#f3efe6]"
          />
        </div>
      )}
      {clip.optional && <span className="text-xs text-yellow-400">opt</span>}
      {trackKind === "video" && index > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <label className="text-[#a39b8f]">Trans</label>
          <select
            value={clip.transition}
            onChange={(e) => onUpdate({ transition: e.target.value })}
            className="rounded bg-[#0d0c0a] px-1 py-0.5 text-[#f3efe6]"
          >
            {TRANSITION_OPTIONS.map((t) => (
              <option key={t} value={t}>{TRANSITION_LABELS[t]}</option>
            ))}
          </select>
        </div>
      )}
      <button onClick={onRemove} className="ml-auto text-[#a39b8f] hover:text-red-400">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function TrackEditor({
  track,
  availableAssets,
  onReorder,
  onUpdateClip,
  onRemoveClip,
  onAddClip,
}: {
  track: Track;
  availableAssets: Asset[];
  onReorder: (oldIndex: number, newIndex: number) => void;
  onUpdateClip: (clipIndex: number, patch: Partial<Clip>) => void;
  onRemoveClip: (clipIndex: number) => void;
  onAddClip: (asset: Asset) => void;
}) {
  const [showAssets, setShowAssets] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = track.clips.findIndex((c) => c.assetId === active.id);
    const newIndex = track.clips.findIndex((c) => c.assetId === over.id);
    if (oldIndex !== -1 && newIndex !== -1) onReorder(oldIndex, newIndex);
  }, [track.clips, onReorder]);

  const totalDuration = track.clips.reduce((sum, c) => sum + c.durationSeconds, 0);

  return (
    <div className="rounded border border-[#2a2620] p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium text-[#c4a574]">{TRACK_LABELS[track.kind]} Track</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#a39b8f]">
            {track.clips.length} clip(s) — {totalDuration.toFixed(1)}s
          </span>
          <Button variant="quiet" onClick={() => setShowAssets(!showAssets)} disabled={availableAssets.length === 0}>
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>
      </div>

      {showAssets && availableAssets.length > 0 && (
        <div className="mt-3 rounded border border-[#39342d] bg-[#1a1714] p-3">
          <p className="mb-2 text-xs text-[#a39b8f]">Available assets:</p>
          <div className="grid gap-1">
            {availableAssets.map((asset) => (
              <button
                key={asset.id}
                onClick={() => { onAddClip(asset); setShowAssets(false); }}
                className="flex items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-[#2a2620]"
              >
                <span className="truncate font-mono text-[#c4a574]">{asset.fileName}</span>
                <span className="text-[#a39b8f]">{asset.durationSeconds?.toFixed(1) ?? "?"}s</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {track.clips.length === 0 ? (
          <p className="text-sm text-[#a39b8f]">No clips. Add assets to build this track.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={track.clips.map((c) => c.assetId)}>
              {track.clips.map((clip, index) => (
                <SortableClip
                  key={`${clip.assetId}-${index}`}
                  clip={clip}
                  index={index}
                  trackKind={track.kind}
                  onUpdate={(patch) => onUpdateClip(index, patch)}
                  onRemove={() => onRemoveClip(index)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

export function TimelineEditor({ projectId }: { projectId: string }) {
  const [episodeId, setEpisodeId] = useState("");
  const [episodes, setEpisodes] = useState<{ id: string; episodeNumber: number; title: string }[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [data, setData] = useState<EditableTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ episodes: { id: string; episodeNumber: number; title: string }[] }>(
      `/api/projects/${projectId}/episodes`
    )
      .then((d) => { if (active) setEpisodes(d.episodes); })
      .catch(() => { if (active) setError("Failed to load episodes."); })
      .finally(() => { if (active) setEpisodesLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const load = useCallback(async () => {
    if (!episodeId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<EditableTimeline>(
        `/api/projects/${projectId}/episodes/${episodeId}/timeline`
      );
      setData(result);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId]);

  const createEmpty = useCallback(async () => {
    if (!episodeId) return;
    setLoading(true);
    setError(null);
    try {
      await api<{ timeline: Timeline }>(
        `/api/projects/${projectId}/episodes/${episodeId}/timeline`,
        { method: "POST" }
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create timeline");
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId, load]);

  const save = useCallback(async () => {
    if (!data?.timeline || !episodeId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ timeline: Timeline }>(
        `/api/projects/${projectId}/episodes/${episodeId}/timeline`,
        {
          method: "PATCH",
          body: JSON.stringify({ tracks: data.timeline.tracks }),
        }
      );
      setData({ ...data, timeline: result.timeline });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [projectId, episodeId, data]);

  const approve = useCallback(async () => {
    if (!episodeId) return;
    setApproving(true);
    setError(null);
    try {
      const result = await api<{ timeline: Timeline }>(
        `/api/projects/${projectId}/episodes/${episodeId}/timeline/approve`,
        { method: "POST" }
      );
      if (data) setData({ ...data, timeline: result.timeline });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  }, [projectId, episodeId, data]);

  const updateTracks = useCallback((tracks: Track[]) => {
    setData((prev) => prev ? { ...prev, timeline: prev.timeline ? { ...prev.timeline, tracks } : null } : prev);
    setDirty(true);
  }, []);

  const handleReorder = useCallback((kind: TrackKind, oldIndex: number, newIndex: number) => {
    if (!data?.timeline) return;
    const tracks = data.timeline.tracks.map((t) => {
      if (t.kind !== kind) return t;
      return { ...t, clips: arrayMove(t.clips, oldIndex, newIndex) };
    });
    updateTracks(tracks);
  }, [data, updateTracks]);

  const handleUpdateClip = useCallback((kind: TrackKind, clipIndex: number, patch: Partial<Clip>) => {
    if (!data?.timeline) return;
    const tracks = data.timeline.tracks.map((t) => {
      if (t.kind !== kind) return t;
      const clips = [...t.clips];
      clips[clipIndex] = { ...clips[clipIndex], ...patch };
      return { ...t, clips };
    });
    updateTracks(tracks);
  }, [data, updateTracks]);

  const handleRemoveClip = useCallback((kind: TrackKind, clipIndex: number) => {
    if (!data?.timeline) return;
    const tracks = data.timeline.tracks.map((t) => {
      if (t.kind !== kind) return t;
      return { ...t, clips: t.clips.filter((_, i) => i !== clipIndex) };
    });
    updateTracks(tracks);
  }, [data, updateTracks]);

  const handleAddClip = useCallback((kind: TrackKind, asset: Asset) => {
    if (!data?.timeline) return;
    const tracks = data.timeline.tracks.map((t) => {
      if (t.kind !== kind) return t;
      const startSeconds = t.clips.length > 0
        ? Math.max(...t.clips.map((c) => c.startSeconds + c.durationSeconds))
        : 0;
      return { ...t, clips: [...t.clips, makeClip(asset, startSeconds)] };
    });
    updateTracks(tracks);
  }, [data, updateTracks]);

  const timeline = data?.timeline;
  const hasBlockingErrors = timeline
    ? timeline.validation.missingAssets.length > 0 || timeline.validation.brokenReferences.length > 0
    : true;

  const tracksByKind = useMemo(() => {
    const map = new Map<TrackKind, Track>();
    for (const kind of TRACK_KINDS) {
      const track = timeline?.tracks.find((t) => t.kind === kind);
      map.set(kind, track ?? { kind, clips: [] });
    }
    return map;
  }, [timeline]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Timeline Editor</h1>
        {error ? <p className="text-red-400">{error}</p> : null}

        <div className="flex gap-3 items-center">
          <select
            className="studio-field flex-1"
            value={episodeId}
            onChange={(e) => { setEpisodeId(e.target.value); setData(null); }}
            disabled={episodesLoading}
          >
            <option value="">{episodesLoading ? "Loading episodes…" : "Select an episode…"}</option>
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                Episode {ep.episodeNumber}: {ep.title || "Untitled"}
              </option>
            ))}
          </select>
          <Button onClick={load} disabled={!episodeId || loading}>
            {loading ? "Loading..." : "Load timeline"}
          </Button>
          {timeline === null && !loading ? (
            <Button onClick={createEmpty} disabled={!episodeId || loading} variant="quiet">
              Create empty timeline
            </Button>
          ) : null}
        </div>

        {timeline ? (
          <div className="grid gap-4">
            <div className="rounded border border-[#39342d] p-4">
              <div className="flex items-center justify-between">
                <div className="grid gap-1">
                  <p className="font-medium">
                    {timeline.outputResolution} @ {timeline.frameRate}fps ({timeline.aspectRatio})
                  </p>
                  <p className="text-sm text-[#a39b8f]">
                    Status:{" "}
                    <span className={
                      timeline.status === "approved" ? "text-green-400" :
                      timeline.status === "stale" ? "text-yellow-400" :
                      "text-[#a39b8f]"
                    }>
                      {timeline.status}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={save} disabled={!dirty || saving || timeline.status === "approved"} variant="quiet">
                    <Save size={14} className="mr-1" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    onClick={approve}
                    disabled={hasBlockingErrors || approving || timeline.status === "approved" || dirty}
                    variant="quiet"
                  >
                    <Check size={14} className="mr-1" />
                    {approving ? "Approving..." : timeline.status === "approved" ? "Approved" : "Approve"}
                  </Button>
                </div>
              </div>
            </div>

            {TRACK_KINDS.map((kind) => {
              const track = tracksByKind.get(kind)!;
              const assets = data?.availableAssets[kind] ?? [];
              return (
                <TrackEditor
                  key={kind}
                  track={track}
                  availableAssets={assets}
                  onReorder={(oldIndex, newIndex) => handleReorder(kind, oldIndex, newIndex)}
                  onUpdateClip={(clipIndex, patch) => handleUpdateClip(kind, clipIndex, patch)}
                  onRemoveClip={(clipIndex) => handleRemoveClip(kind, clipIndex)}
                  onAddClip={(asset) => handleAddClip(kind, asset)}
                />
              );
            })}

            {(timeline.validation.missingAssets.length > 0 ||
              timeline.validation.brokenReferences.length > 0 ||
              timeline.validation.overlaps.length > 0 ||
              timeline.validation.durationMismatch ||
              timeline.validation.warnings.length > 0) ? (
              <div className="rounded border border-red-900/50 bg-red-950/20 p-4">
                <p className="font-medium text-red-400">Validation findings</p>
                <ul className="mt-2 grid gap-1 text-sm text-red-300">
                  {timeline.validation.missingAssets.map((id) => (
                    <li key={`missing-${id}`}>Missing asset: {id}</li>
                  ))}
                  {timeline.validation.brokenReferences.map((id) => (
                    <li key={`broken-${id}`}>Broken reference: {id}</li>
                  ))}
                  {timeline.validation.overlaps.map((o, k) => (
                    <li key={`overlap-${k}`}>Overlap in {String(o.track ?? "unknown")} track</li>
                  ))}
                  {timeline.validation.durationMismatch ? (
                    <li>Duration mismatch: video total differs from target by more than 10%</li>
                  ) : null}
                  {timeline.validation.warnings.map((w, k) => (
                    <li key={`warn-${k}`} className="text-yellow-400">{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded border border-green-900/50 bg-green-950/20 p-4">
                <p className="text-green-400">No validation issues — timeline is ready for approval.</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}