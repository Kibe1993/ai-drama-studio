import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="font-display text-5xl">Page not found</h1>
      <Link href="/" className="mt-6 inline-block text-[#c4a574]">
        Back to the studio
      </Link>
    </main>
  );
}
