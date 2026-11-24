"use client";

import { useEffect, useState } from "react";
import { LANGUAGES } from "@/lib/domain/projectCatalog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/hooks/api";
import { Check } from "lucide-react";

type Account = {
  email: string;
  name: string;
  preferences: { language: string };
};

export default function SettingsPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [language, setLanguage] = useState("en");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    api<Account>("/api/account")
      .then((data) => {
        if (!active) return;
        setAccount(data);
        setLanguage(data.preferences.language);
      })
      .catch(() => {
        if (active) setError("Account settings could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase">Account</p>
      <h1 className="font-display mt-2 text-5xl">Settings</h1>
      <p className="mt-4 text-[#cfc6b8] leading-relaxed">
        Provider keys stay on the server. This page stores your language preference.
      </p>
      {account ? (
        <form
          className="mt-8 rounded-xl border border-[#2e2a25] bg-[#181612] p-6 grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setSaved(false);
            setError("");
            try {
              const next = await api<Account>("/api/account", {
                method: "PATCH",
                body: JSON.stringify({ language }),
              });
              setAccount(next);
              setSaved(true);
            } catch (cause) {
              setError(cause instanceof ApiError ? cause.message : "The preference could not be saved.");
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="border-b border-[#2e2a25] pb-4">
            <p className="text-[#f3efe6] font-medium">{account.name || account.email || "Signed in"}</p>
            {account.email ? <p className="mt-0.5 text-sm text-[#a39b8f]">{account.email}</p> : null}
          </div>
          <label className="grid gap-2">
            <Label>Preferred language</Label>
            <select className="studio-field" value={language} onChange={(event) => setLanguage(event.target.value)}>
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save preference"}
            </Button>
            {saved ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[#6bb36b]">
                <Check size={14} strokeWidth={2} />
                Saved
              </span>
            ) : null}
            {error ? <span className="text-sm text-[#e7b2a8]">{error}</span> : null}
          </div>
        </form>
      ) : (
        <p className="mt-8 text-[#a39b8f]">{error || "Loading settings…"}</p>
      )}
    </div>
  );
}
