import { resolveProductBrand } from "@ai-job-apply/config/brand";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

const productBrand = resolveProductBrand({
  name: process.env.NEXT_PUBLIC_PRODUCT_BRAND_NAME,
  candidateDomain: process.env.NEXT_PUBLIC_PRODUCT_BRAND_DOMAIN,
});

export const metadata: Metadata = {
  title: `${productBrand.name} — Foundation`,
  description: "Rapid, tailored, quality-gated job applications.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
