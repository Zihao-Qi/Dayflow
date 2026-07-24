import type { Metadata } from "next";
import { FocusSessionProvider } from "@/components/focus-session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dayflow",
  description: "A local-first personal productivity dashboard."
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
