import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Fest Help",
  description: "Ask about fest events, timings, venues and registration.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#000000",
};

// Matches the void black colours in globals.css.
const clerkAppearance = {
  variables: {
    colorBackground: "#0c0c0e",
    colorForeground: "#f5f5f7",
    colorMuted: "#26262a",
    colorMutedForeground: "#a6a6ad",
    colorInput: "#000000",
    colorInputForeground: "#f5f5f7",
    colorBorder: "#7a7a82",
    colorNeutral: "#ffffff",
    colorPrimary: "#ff6a2b",
    colorPrimaryForeground: "#000000",
    colorDanger: "#ff8f8f",
    colorRing: "#ff6a2b",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ClerkProvider
          appearance={clerkAppearance}
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
