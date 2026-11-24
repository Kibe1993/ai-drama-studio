import Link from "next/link";
import { Users, ArrowRight } from "lucide-react";

export default function CharactersPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase">Library</p>
      <h1 className="font-display mt-2 text-5xl">Characters</h1>
      <div className="mt-8 rounded-xl border border-[#2e2a25] bg-[#181612] px-6 py-12 text-center">
        <Users size={36} strokeWidth={1.5} className="mx-auto text-[#6b6258]" />
        <p className="mt-4 max-w-md mx-auto text-[#cfc6b8] leading-relaxed">
          Character profiles and reference images are managed within each project.
          They stay with the project when you return.
        </p>
        <Link
          href="/projects"
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-[#c4a574] transition-colors hover:text-[#d4b784]"
        >
          Browse projects
          <ArrowRight size={14} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
