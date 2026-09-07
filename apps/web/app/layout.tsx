import type { Metadata } from "next";
import "./globals.css";
import { Chrome } from "@/components/Chrome";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Same Story · CineMemory",
  description: "Social stories that stay the same in every picture, verified before a child sees them.",
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
