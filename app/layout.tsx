import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo-chat",
  description: "Paste a GitHub repo, get an architecture brief, then chat with the code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
