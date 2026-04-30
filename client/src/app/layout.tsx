import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
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
  title: "Demineurs V2",
  description: "Real-time co-op Minesweeper.",
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
        {children}
        <Toaster
          position="top-center"
          theme="dark"
          toastOptions={{
            style: {
              background: 'rgba(17, 23, 45, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              color: '#e8ecff',
              boxShadow: '0 20px 60px -15px rgba(0, 0, 0, 0.6)',
            },
            classNames: {
              toast: 'rounded-2xl',
              title: 'text-cyan-accent font-bold',
              description: 'text-slate-300',
              actionButton: 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold',
              cancelButton: 'bg-white/10 hover:bg-white/20 text-slate-200',
            },
          }}
        />
      </body>
    </html>
  );
}
