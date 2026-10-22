"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CandidateNameProvider } from "../candidate-name-context";
import { useInboxUnread } from "../use-inbox-unread";

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
  const unread = useInboxUnread(true);
  // The inbox link appears only when the platform serves an inbox.
  const items =
    unread === undefined
      ? navItems
      : [
          navItems[0],
          { href: "/inbox", label: unread > 0 ? `Inbox (${unread})` : "Inbox" },
          ...navItems.slice(1),
        ];
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <p className="app-topbar-brand">{brandName}</p>
        {displayName && <span className="app-topbar-user">{displayName}</span>}
      </header>
      <div className="dashboard">
        <aside className="dashboard-sidebar">
          <nav aria-label="Sections" className="dashboard-nav">
            {items.map((item) => (
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
        <div className="dashboard-content">
          <CandidateNameProvider value={displayName}>{children}</CandidateNameProvider>
        </div>
      </div>
    </div>
  );
}
