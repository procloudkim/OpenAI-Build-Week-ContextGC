import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0].trim();
  const directHost = requestHeaders.get("host")?.trim();
  const candidateHost = forwardedHost ?? directHost ?? "localhost";
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(candidateHost)
    ? candidateHost
    : "localhost";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : safeHost.startsWith("localhost")
        ? "http"
        : "https";
  const origin = `${protocol}://${safeHost}`;
  const imageUrl = new URL("/og.jpeg", origin).toString();

  return {
    title: "ContextGC — Auditable context control for Codex",
    description:
      "A local-first, reversible control plane that protects critical context around Codex compaction.",
    applicationName: "ContextGC",
    keywords: ["Codex", "context management", "developer tools", "AI agents"],
    openGraph: {
      title: "ContextGC — Keep the truth. Compress the noise.",
      description:
        "Local-first, reversible context control for long-running Codex work.",
      type: "website",
      images: [{ url: imageUrl, width: 1792, height: 938, alt: "ContextGC" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ContextGC — Keep the truth. Compress the noise.",
      description:
        "Local-first, reversible context control for long-running Codex work.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
