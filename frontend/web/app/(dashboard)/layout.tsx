import { resolveProductBrand } from "@ai-job-apply/config/brand";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuth0Client, isAuth0Configured } from "../../lib/auth0";
import { SessionExpiryGuard } from "../session-expiry-guard";
import { DashboardShell } from "./dashboard-shell";

export const dynamic = "force-dynamic";

const productBrand = resolveProductBrand({
  name: process.env.NEXT_PUBLIC_PRODUCT_BRAND_NAME,
  candidateDomain: process.env.NEXT_PUBLIC_PRODUCT_BRAND_DOMAIN,
});

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const authConfigured = isAuth0Configured();
  const session = authConfigured ? await getAuth0Client().getSession() : null;
  if (!authConfigured || !session) {
    redirect("/");
  }
  const displayName = typeof session.user.name === "string" ? session.user.name : undefined;

  return (
    <DashboardShell brandName={productBrand.name} displayName={displayName}>
      <SessionExpiryGuard />
      {children}
    </DashboardShell>
  );
}
