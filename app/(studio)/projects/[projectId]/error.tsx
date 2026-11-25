"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-5xl py-12">
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6">
        <h2 className="font-display text-2xl text-red-400">Something went wrong</h2>
        <p className="mt-2 text-sm text-red-300">{error.message || "An unexpected error occurred."}</p>
        {error.digest ? (
          <p className="mt-1 text-xs text-red-400/60">Error ID: {error.digest}</p>
        ) : null}
        <button
          onClick={reset}
          className="mt-4 rounded border border-red-900/50 px-4 py-2 text-sm text-red-300 transition hover:bg-red-950/40"
        >
          Try again
        </button>
      </div>
    </div>
  );
}