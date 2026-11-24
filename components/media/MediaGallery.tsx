"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Pause, Trash2, Download, FileVideo, FileAudio, FileImage, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type AssetType = "character_reference" | "scene_image" | "scene_video" | "dialogue_audio" | "narration_audio" | "music" | "sound_effect" | "subtitle" | "final_render";
type ReviewStatus = "pending" | "approved" | "rejected" | "archived";

type Asset = {
  id: string;
  type: AssetType;
  provider: string;
  model: string;
  mimeType: string;
  fileName: string;
  byteSize: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  episodeId: string | null;
  sceneId: string | null;
  shotId: string | null;
  storageProvider: string;
  validationStatus: string;
  storageVerified: boolean;
  reviewStatus: ReviewStatus;
  isMock: boolean;
  createdAt: string;
};

type ListResponse = { assets: Asset[]; total: number; limit: number; offset: number };

const TYPE_LABELS: Record<AssetType, string> = {
  character_reference: "Character Ref",
  scene_image: "Scene Image",
  scene_video: "Scene Video",
  dialogue_audio: "Dialogue",
  narration_audio: "Narration",
  music: "Music",
  sound_effect: "SFX",
  subtitle: "Subtitle",
  final_render: "Final Render",
};

const TYPE_ICONS: Record<AssetType, typeof FileVideo> = {
  character_reference: FileImage,
  scene_image: FileImage,
  scene_video: FileVideo,
  dialogue_audio: FileAudio,
  narration_audio: FileAudio,
  music: FileAudio,
  sound_effect: FileAudio,
  subtitle: FileText,
  final_render: FileVideo,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

function AudioPreview({ projectId, assetId, mimeType }: { projectId: string; assetId: string; mimeType: string }) {
  const [playing, setPlaying] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (!audio) {
      const el = new Audio(`/api/projects/${projectId}/media/${assetId}`);
      el.onended = () => setPlaying(false);
      setAudio(el);
      el.play();
      setPlaying(true);
    } else if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  }, [audio, playing, projectId, assetId]);

  useEffect(() => {
    return () => { audio?.pause(); };
  }, [audio]);

  return (
    <button onClick={toggle} className="text-[#c4a574] hover:text-[#f3efe6]" title={mimeType}>
      {playing ? <Pause size={16} /> : <Play size={16} />}
    </button>
  );
}

function AssetCard({ asset, projectId, onDelete }: { asset: Asset; projectId: string; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const Icon = TYPE_ICONS[asset.type];
  const isAudio = asset.mimeType.startsWith("audio/");
  const isVideo = asset.mimeType.startsWith("video/");
  const isImage = asset.mimeType.startsWith("image/");

  return (
    <div className="flex flex-col gap-2 rounded border border-[#2a2620] bg-[#1a1714] p-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-[#a39b8f]" />
          <span className="text-xs text-[#a39b8f]">{TYPE_LABELS[asset.type]}</span>
        </div>
        {asset.isMock && (
          <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-xs text-yellow-400">MOCK</span>
        )}
      </div>

      <p className="truncate text-sm font-medium text-[#f3efe6]" title={asset.fileName}>{asset.fileName}</p>

      <div className="grid grid-cols-2 gap-1 text-xs text-[#a39b8f]">
        <span>{formatBytes(asset.byteSize)}</span>
        {asset.durationSeconds !== null && <span>{formatDuration(asset.durationSeconds)}</span>}
        {asset.width !== null && asset.height !== null && (
          <span>{asset.width}×{asset.height}</span>
        )}
        {asset.frameRate !== null && <span>{asset.frameRate}fps</span>}
      </div>

      <div className="flex items-center gap-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 ${
          asset.reviewStatus === "approved" ? "bg-green-900/30 text-green-400" :
          asset.reviewStatus === "rejected" ? "bg-red-900/30 text-red-400" :
          asset.reviewStatus === "archived" ? "bg-gray-900/30 text-gray-400" :
          "bg-[#2a2620] text-[#a39b8f]"
        }`}>
          {asset.reviewStatus}
        </span>
        <span className="text-[#a39b8f]">{new Date(asset.createdAt).toLocaleDateString()}</span>
      </div>

      <div className="flex items-center gap-2 border-t border-[#2a2620] pt-2">
        {isAudio && <AudioPreview projectId={projectId} assetId={asset.id} mimeType={asset.mimeType} />}
        {isImage && (
          <img
            src={`/api/projects/${projectId}/media/${asset.id}`}
            alt={asset.fileName}
            className="h-8 w-8 rounded object-cover"
            loading="lazy"
          />
        )}
        <a
          href={`/api/projects/${projectId}/media/${asset.id}`}
          download={asset.fileName}
          className="text-[#a39b8f] hover:text-[#c4a574]"
          title="Download"
        >
          <Download size={16} />
        </a>
        {confirming ? (
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => onDelete(asset.id)} className="text-xs text-red-400 hover:text-red-300">Confirm</button>
            <button onClick={() => setConfirming(false)} className="text-xs text-[#a39b8f] hover:text-[#f3efe6]">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="ml-auto text-[#a39b8f] hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

const FILTER_TYPES: (AssetType | "")[] = ["", "scene_video", "dialogue_audio", "narration_audio", "scene_image", "character_reference", "music", "sound_effect", "subtitle", "final_render"];
const FILTER_REVIEW: (ReviewStatus | "")[] = ["", "pending", "approved", "rejected", "archived"];

export function MediaGallery({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<AssetType | "">("");
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | "">("");
  const [mockFilter, setMockFilter] = useState<"all" | "real" | "mock">("all");
  const [offset, setOffset] = useState(0);
  const limit = 24;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (reviewFilter) params.set("reviewStatus", reviewFilter);
      if (mockFilter === "mock") params.set("isMock", "true");
      if (mockFilter === "real") params.set("isMock", "false");
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      const data = await api<ListResponse>(`/api/projects/${projectId}/media?${params}`);
      setAssets(data.assets);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, typeFilter, reviewFilter, mockFilter, offset]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (assetId: string) => {
    try {
      await api(`/api/projects/${projectId}/media/${assetId}`, { method: "DELETE" });
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      setTotal((prev) => prev - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [projectId]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Media Library</h1>
        {error ? (
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as AssetType | ""); setOffset(0); }}
            className="studio-field"
          >
            {FILTER_TYPES.map((t) => (
              <option key={t} value={t}>{t === "" ? "All types" : TYPE_LABELS[t]}</option>
            ))}
          </select>

          <select
            value={reviewFilter}
            onChange={(e) => { setReviewFilter(e.target.value as ReviewStatus | ""); setOffset(0); }}
            className="studio-field"
          >
            {FILTER_REVIEW.map((r) => (
              <option key={r} value={r}>{r === "" ? "All statuses" : r}</option>
            ))}
          </select>

          <select
            value={mockFilter}
            onChange={(e) => { setMockFilter(e.target.value as "all" | "real" | "mock"); setOffset(0); }}
            className="studio-field"
          >
            <option value="all">All assets</option>
            <option value="real">Real only</option>
            <option value="mock">Mock only</option>
          </select>

          <span className="text-sm text-[#a39b8f]">{total} asset(s)</span>
        </div>

        {loading ? (
          <p className="text-[#a39b8f]">Loading...</p>
        ) : assets.length === 0 ? (
          <div className="rounded border border-[#2a2620] p-8 text-center">
            <p className="text-[#a39b8f]">No media assets found. Assets will appear here after generation.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} projectId={projectId} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {total > limit && (
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="quiet"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <span className="text-sm text-[#a39b8f]">
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <Button
              variant="quiet"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}