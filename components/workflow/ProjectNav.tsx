"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./ProjectNav.module.css";

type NavItem = {
  href: string;
  label: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

function buildGroups(projectId: string): NavGroup[] {
  const base = `/projects/${projectId}`;
  return [
    {
      label: "Creative",
      items: [
        { href: `${base}/planning`, label: "Planning" },
        { href: `${base}/bible`, label: "Story Bible" },
        { href: `${base}/review`, label: "Review" },
      ],
    },
    {
      label: "Structural",
      items: [
        { href: `${base}/episodes`, label: "Episodes" },
        { href: `${base}/plan`, label: "Season Plan" },
        { href: `${base}/characters`, label: "Characters" },
        { href: `${base}/scenes`, label: "Scenes" },
        { href: `${base}/story`, label: "Screenplay" },
        { href: `${base}/canon`, label: "Canon" },
      ],
    },
    {
      label: "Production",
      items: [
        { href: `${base}/production-design`, label: "Design" },
        { href: `${base}/production`, label: "Production" },
        { href: `${base}/shots`, label: "Shots" },
        { href: `${base}/visual-assets`, label: "Visual Assets" },
        { href: `${base}/audio`, label: "Audio" },
        { href: `${base}/video`, label: "Video" },
      ],
    },
    {
      label: "Output",
      items: [
        { href: `${base}/timeline`, label: "Timeline" },
        { href: `${base}/assembly`, label: "Assembly" },
        { href: `${base}/rendering`, label: "Rendering" },
        { href: `${base}/media`, label: "Media" },
      ],
    },
  ];
}

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const groups = buildGroups(projectId);

  return (
    <nav className={styles.nav}>
      {groups.map((group) => (
        <div key={group.label} className={styles.group}>
          <span className={styles.groupLabel}>{group.label}</span>
          <div className={styles.items}>
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? `${styles.link} ${styles.active}` : styles.link}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}