"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type VoiceProfile = {
  id: string;
  canonicalEntityId: string;
  voiceDescription: string;
  preferredProvider: string;
  voiceIdentifier: string;
  language: string;
  accent: string;
  speakingStyle: string;
  status: "draft" | "approved";
};

export default function AudioPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ profiles: VoiceProfile[] }>(
        `/api/projects/${projectId}/characters/000000000000000000000000/voice-profile`
      );
      setProfiles(data.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  if (profiles.length === 0 && !loading && !error) {
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Audio Production</h1>
        {error ? <p className="text-red-400">{error}</p> : null}

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Voice Profiles</h2>
          {profiles.length === 0 ? (
            <p className="mt-4 text-[#a39b8f]">No voice profiles yet. Assign voices to characters for dialogue generation.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {profiles.map((profile) => (
                <div key={profile.id} className="rounded border border-[#2a2620] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{profile.voiceDescription || profile.voiceIdentifier || "Voice profile"}</p>
                      <p className="text-sm text-[#a39b8f]">
                        {profile.preferredProvider} · {profile.language}
                        {profile.accent ? ` · ${profile.accent}` : ""}
                      </p>
                    </div>
                    <span className={profile.status === "approved" ? "text-green-400" : "text-yellow-400"}>
                      {profile.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Dialogue & Sound</h2>
          <p className="mt-4 text-[#a39b8f]">
            Dialogue is generated from the approved screenplay. Sound effects, ambience, and music
            are associated with scenes and shots.
          </p>
        </section>
      </div>
    </div>
  );
}