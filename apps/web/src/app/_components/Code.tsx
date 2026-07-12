"use client";

import { useState } from "react";

export type Lang = "ts" | "py" | "json";

export interface Snippet {
  id: string;
  label: string;
  lang: Lang;
  code: string;
}

const KEYWORDS: Record<Lang, Set<string>> = {
  ts: new Set([
    "import", "from", "const", "let", "await", "new", "async", "function",
    "return", "export", "type", "interface", "void", "as", "extends",
  ]),
  py: new Set([
    "import", "from", "def", "return", "await", "async", "for", "in", "if",
    "else", "with", "as", "print", "not", "and", "or", "class", "lambda",
  ]),
  json: new Set([]),
};

const LITERALS = new Set(["true", "false", "null", "None", "True", "False"]);

// Order matters: comment, string, number, identifier, whitespace, punctuation.
const TOKEN_RE =
  /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(-?\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\s])/g;

interface Tok {
  c: string;
  t: string;
}

function tokenize(line: string, lang: Lang): Tok[] {
  const out: Tok[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m[1]) out.push({ c: "tok-com", t: m[1] });
    else if (m[2]) out.push({ c: "tok-str", t: m[2] });
    else if (m[3]) out.push({ c: "tok-num", t: m[3] });
    else if (m[4]) {
      const w = m[4];
      if (LITERALS.has(w)) out.push({ c: "tok-lit", t: w });
      else if (KEYWORDS[lang].has(w)) out.push({ c: "tok-kw", t: w });
      else out.push({ c: "tok-id", t: w });
    } else if (m[6]) out.push({ c: "tok-pun", t: m[6] });
    else out.push({ c: "", t: m[0] });
  }
  // Re-classify object/JSON keys: a string immediately followed by ":".
  for (let i = 0; i < out.length; i++) {
    const tok = out[i];
    if (!tok || tok.c !== "tok-str") continue;
    let j = i + 1;
    while (j < out.length && out[j]?.c === "") j++;
    const next = out[j];
    if (next && next.t.startsWith(":")) tok.c = "tok-key";
  }
  return out;
}

export function CodeBlock({ code, lang }: { code: string; lang: Lang }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <pre className="lp-code-pre">
      <code>
        {lines.map((line, i) => (
          <span className="lp-code-line" key={i}>
            {tokenize(line, lang).map((tk, j) =>
              tk.c ? (
                <span key={j} className={tk.c}>
                  {tk.t}
                </span>
              ) : (
                <span key={j}>{tk.t}</span>
              ),
            )}
            {i < lines.length - 1 ? "\n" : ""}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function CodeTabs({ snippets }: { snippets: Snippet[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const cur = snippets[active] ?? snippets[0];
  if (!cur) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cur.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <div className="lp-codecard">
      <div className="lp-codecard-bar">
        <div className="lp-codecard-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="lp-codecard-tabs" role="tablist">
          {snippets.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === active}
              className={`lp-tab ${i === active ? "is-active" : ""}`}
              onClick={() => setActive(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button className="lp-copy" onClick={copy} aria-label="Copy code">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <CodeBlock code={cur.code} lang={cur.lang} />
    </div>
  );
}
