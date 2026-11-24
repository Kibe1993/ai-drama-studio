"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Clapperboard, Film, FolderOpen, Settings, Users, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", icon: Clapperboard },
  { href: "/projects", label: "My Projects", icon: FolderOpen },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/media", label: "Media Library", icon: Film },
  { href: "/mcp", label: "MCP Server", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-[#2e2a25] bg-[#0f0e0c] md:border-b-0 md:border-r md:min-h-screen">
        <div className="flex items-center justify-between px-5 py-5 md:block">
          <Link href="/" className="font-display text-2xl tracking-tight text-[#f3efe6] no-underline">
            Drama Studio
          </Link>
          <div className="md:mt-6">
            <UserButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:grid md:gap-0.5 md:px-3 md:pb-6">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#cfc6b8] transition-colors duration-150",
                  active
                    ? "bg-[#2a261f] text-[#f3efe6]"
                    : "hover:bg-[#1a1815] hover:text-[#f3efe6]"
                )}
              >
                <Icon size={16} strokeWidth={1.75} style={{ color: active ? "#c4a574" : undefined }} />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 px-6 py-8 sm:px-10 sm:py-10">{children}</main>
    </div>
  );
}
