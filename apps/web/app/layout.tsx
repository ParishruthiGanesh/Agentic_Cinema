import type { Metadata } from "next";
import "./globals.css";
import { Chrome } from "@/components/Chrome";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Story Ahead",
  description: "See what happens next, one calm picture at a time. Social stories for autistic children, with pictures that stay the same and are checked before your child sees them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <Chrome>{children}</Chrome>
        </AuthProvider>
      </body>
    </html>
  );
}
