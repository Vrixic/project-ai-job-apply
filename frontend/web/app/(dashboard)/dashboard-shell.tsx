"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/jobs", label: "Jobs" },
  { href: "/resume", label: "Resume" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
] as const;

export function DashboardShell({
  brandName,
  displayName,
  children,
}: {
  brandName: string;
  displayName?: string | undefined;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <p className="app-topbar-brand">{brandName}</p>
        {displayName && <span className="app-topbar-user">{displayName}</span>}
      </header>
      <div className="dashboard">
        <aside className="dashboard-sidebar">
          <nav aria-label="Sections" className="dashboard-nav">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="dashboard-nav-item"
                aria-current={pathname === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="dashboard-content">{children}</div>
      </div>
    </div>
  );
}
