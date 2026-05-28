import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Knowledge Hub",
  description: "Search and chat with your team's documentation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Fumadocs's RootProvider (next-themes under the hood) injects
      // `style="color-scheme: ..."` onto <html> after mount. Without this,
      // hydration warns on every /docs page load.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} dark antialiased bg-background`}
    >
      {/*
        Body allows normal page scroll so /docs (Fumadocs sticky sidebar +
        normal scroll) works. The chat hub's fixed three-pane layout enforces
        its own h-screen + overflow-hidden inside src/app/(app)/layout.tsx.
      */}
      <body className="min-h-screen font-sans bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors />
      </body>
    </html>
  );
}
