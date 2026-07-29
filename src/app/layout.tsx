import type { Metadata, Viewport } from "next";
import { FocusSessionProvider } from "@/components/focus-session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dayflow",
  description:
    "A local-first personal workspace for deciding, planning, recording, capturing, and reviewing.",
  applicationName: "Dayflow",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/dayflow-32.png",
        type: "image/png",
        sizes: "32x32"
      }
    ],
    apple: [
      {
        url: "/icons/dayflow-apple-touch.png",
        type: "image/png",
        sizes: "180x180"
      }
    ]
  },
  appleWebApp: {
    capable: true,
    title: "Dayflow",
    statusBarStyle: "default"
  },
  other: {
    "apple-mobile-web-app-capable": "yes"
  }
};

export const viewport: Viewport = {
  themeColor: "#f8f6f0"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FocusSessionProvider>{children}</FocusSessionProvider>
      </body>
    </html>
  );
}
