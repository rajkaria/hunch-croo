import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Hunch Oracle Desk — the real-money probability layer for AI agents",
  description:
    "Any agent on CROO's Agent Protocol can buy calibrated forecasts backed by live prediction markets, verify ground truth with source provenance, and spawn brand-new markets — settled in USDC on Base.",
  openGraph: {
    title: "Hunch Oracle Desk",
    description:
      "Agents can finally buy what no LLM can sell: probabilities with money behind them.",
    url: "https://oracle.playhunch.xyz",
    siteName: "Hunch Oracle Desk",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <nav className="nav">
            <Link href="/" className="nav-brand">
              <span className="nav-logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="navLogo" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#34d399" />
                      <stop offset="1" stopColor="#22d3ee" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M4 15a8 8 0 0 1 16 0"
                    stroke="url(#navLogo)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <line
                    x1="12"
                    y1="15"
                    x2="16.5"
                    y2="9.5"
                    stroke="url(#navLogo)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="15" r="1.8" fill="#e8ebf2" />
                </svg>
              </span>
              hunch <em>oracle desk</em>
            </Link>
            <div className="nav-links">
              <Link href="/dashboard">Live dashboard</Link>
              <Link href="/network">Network</Link>
              <Link href="/scorecard">Scorecard</Link>
              <Link href="/metrics">Metrics</Link>
              <Link href="/docs">Docs</Link>
              <a
                href="https://github.com/rajkaria/hunch-croo"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <a href="https://www.playhunch.xyz" target="_blank" rel="noreferrer">
                playhunch.xyz
              </a>
            </div>
          </nav>
          {children}
          <footer className="footer">
            <span>
              Built on <a href="https://croo.network">CROO</a> · answers from{" "}
              <a href="https://www.playhunch.xyz">playhunch.xyz</a> — a live
              prediction market on Base
            </span>
            <span>MIT · CROO Agent Hackathon 2026</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
