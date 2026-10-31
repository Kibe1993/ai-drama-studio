"use client";

import { useEffect, useState } from "react";
import { LANGUAGES } from "@/lib/domain/projectCatalog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/hooks/api";

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
      <h1 className="font-display text-5xl">Settings</h1>
      <p className="mt-4 text-[#cfc6b8]">
        Provider keys stay on the server. This page only stores your language preference.
      </p>
      {account ? (
        <form
          className="mt-8 grid gap-5"
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
          <p className="text-[#f3efe6]">{account.name || account.email || "Signed in"}</p>
          {account.email ? <p className="text-sm text-[#a39b8f]">{account.email}</p> : null}
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
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save preference"}
            </Button>
          </div>
          {saved ? <p className="text-sm text-[#c4a574]">Saved.</p> : null}
        </form>
      ) : (
        <p className="mt-8 text-[#a39b8f]">{error || "Loading settings"}</p>
      )}
    </div>
  );
}
