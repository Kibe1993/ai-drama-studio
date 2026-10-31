"use client";

export default function StudioError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <h1 className="font-display text-4xl">The studio could not load</h1>
      <p className="mt-3 text-[#a39b8f]">
        The database or your session did not respond. Your saved projects are still stored.
      </p>
      <button className="mt-6 text-[#c4a574]" type="button" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
