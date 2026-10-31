import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/components/providers";
import "./globals.css";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export const metadata: Metadata = {
  title: "Drama Studio",
  description: "Create short drama projects and carry them through production.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {publishableKey ? (
          <ClerkProvider
            publishableKey={publishableKey}
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            signInFallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
            appearance={{
              variables: {
                colorBackground: "#1c1a17",
                colorText: "#f3efe6",
                colorPrimary: "#c4a574",
                colorInputBackground: "#12110f",
                colorInputText: "#f3efe6",
              },
            }}
          >
            <Providers>{children}</Providers>
          </ClerkProvider>
        ) : (
          <main className="mx-auto max-w-lg px-6 py-24">
            <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase">Drama Studio</p>
            <h1 className="font-display mt-3 text-5xl">Add your keys</h1>
            <p className="mt-4 text-[#cfc6b8]">
              Copy .env.example to .env.local and set the Clerk keys and MONGODB_URI. Restart the app after saving them.
            </p>
          </main>
        )}
      </body>
    </html>
  );
}
