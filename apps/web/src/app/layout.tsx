import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
});

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

function BrandMark() {
  return (
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
        <circle cx="12" cy="15" r="1.8" fill="#eceef4" />
      </svg>
    </span>
  );
}

const FOOT_COLS = [
  {
    h: "The desk",
    links: [
      { t: "Live dashboard", href: "/dashboard" },
      { t: "A2A network", href: "/network" },
      { t: "Scorecard", href: "/scorecard" },
      { t: "Metrics", href: "/metrics" },
    ],
  },
  {
    h: "Developers",
    links: [
      { t: "Docs — hire in 20 lines", href: "/docs" },
      { t: "/api/catalog", href: "/api/catalog" },
      { t: "/llms.txt", href: "/llms.txt" },
      { t: "GitHub", href: "https://github.com/rajkaria/hunch-croo" },
    ],
  },
  {
    h: "Ecosystem",
    links: [
      { t: "CROO Agent Store", href: "https://croo.network" },
      { t: "playhunch.xyz", href: "https://www.playhunch.xyz" },
      { t: "Base", href: "https://base.org" },
      { t: "Basescan", href: "https://basescan.org" },
    ],
  },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} ${serif.variable}`}
    >
      <body>
        <div className="rails" aria-hidden="true" />
        <nav className="nav">
          <div className="inner nav-in">
            <Link href="/" className="nav-brand">
              <BrandMark />
              hunch <em>oracle desk</em>
            </Link>
            <div className="nav-links">
              <Link href="/dashboard">Dashboard</Link>
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
            </div>
            <Link href="/docs" className="btn primary nav-cta">
              Hire the desk
            </Link>
          </div>
        </nav>
        {children}
        <footer className="footer">
          <div className="inner">
            <div className="foot-grid">
              <div className="foot-brand">
                <Link href="/" className="nav-brand">
                  <BrandMark />
                  hunch <em>oracle desk</em>
                </Link>
                <p>
                  The real-money probability layer for AI agents. Three
                  specialist sellers on CROO&apos;s Agent Protocol, backed by
                  live USDC prediction markets on Base.
                </p>
                <p className="foot-status mono">
                  <span className="foot-dot" /> 3 seller agents · USDC on Base ·
                  CAP
                </p>
              </div>
              {FOOT_COLS.map((col) => (
                <div className="foot-col" key={col.h}>
                  <h4>{col.h}</h4>
                  {col.links.map((l) =>
                    l.href.startsWith("http") ? (
                      <a key={l.t} href={l.href} target="_blank" rel="noreferrer">
                        {l.t}
                      </a>
                    ) : (
                      <Link key={l.t} href={l.href}>
                        {l.t}
                      </Link>
                    ),
                  )}
                </div>
              ))}
            </div>
            <div className="foot-note">
              <span>
                Built on <a href="https://croo.network">CROO</a> · answers from{" "}
                <a href="https://www.playhunch.xyz">playhunch.xyz</a> — a live
                prediction market on Base
              </span>
              <span>MIT · CROO Agent Hackathon 2026</span>
            </div>
          </div>
          <div className="foot-mark" aria-hidden="true">
            oracle desk
          </div>
        </footer>
      </body>
    </html>
  );
}
