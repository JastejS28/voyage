import type { Metadata } from "next";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { stackClientApp } from "../stack/client";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voyage — AI Copilot for Travel Agents",
  description: "Extract structured travel requirements from conversations instantly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <StackProvider app={stackClientApp}>
          <StackTheme>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                style: { fontFamily: "var(--font-geist-sans)" },
                success: { duration: 3000 },
                error: { duration: 5000 },
              }}
            />
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
