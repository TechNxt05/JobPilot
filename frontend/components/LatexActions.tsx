"use client";

import { useState } from "react";
import { Download, ExternalLink, FileCode, Loader2 } from "lucide-react";
import { OVERLEAF_NEW_PROJECT_URL } from "@internova/core";
import { Button } from "@/components/ui";

export function b64ToBlobUrl(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/** Opens the LaTeX as a new Overleaf project (Overleaf's documented /docs endpoint, form POST in a new tab). */
export function openInOverleaf(latex: string, name: string) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = OVERLEAF_NEW_PROJECT_URL;
  form.target = "_blank";
  for (const [k, v] of [["encoded_snip", encodeURIComponent(latex)], ["snip_name", name]]) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/** Compile LaTeX via /api/latex. Returns a blob URL + page count, or throws with the LaTeX error excerpt. */
export async function compileToPdf(latex: string): Promise<{ url: string; pages: number }> {
  const res = await fetch("/api/latex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latex }) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error([body.error ?? `Compile failed (${res.status})`, body.log].filter(Boolean).join("\n"));
  }
  return { url: URL.createObjectURL(await res.blob()), pages: Number(res.headers.get("X-Page-Count") || 0) };
}

/** Buttons for a LaTeX document: download PDF (compiling if needed), open in Overleaf, download .tex. */
export function LatexActions({ latex, filename, pdfUrl, onCompiled }: {
  latex: string;
  filename: string;
  pdfUrl?: string | null;
  onCompiled?: (r: { url: string; pages: number }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setError(null);
            if (pdfUrl) return download(pdfUrl, `${filename}.pdf`);
            setBusy(true);
            try {
              const r = await compileToPdf(latex);
              onCompiled?.(r);
              download(r.url, `${filename}.pdf`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin mr-2" size={16} /> : <Download className="mr-2" size={16} />} Download PDF
        </Button>
        <Button variant="outline" onClick={() => openInOverleaf(latex, `${filename}.tex`)}>
          <ExternalLink className="mr-2" size={16} /> Open in Overleaf
        </Button>
        <Button variant="outline" onClick={() => download(URL.createObjectURL(new Blob([latex], { type: "application/x-tex" })), `${filename}.tex`)}>
          <FileCode className="mr-2" size={16} /> Download .tex
        </Button>
      </div>
      {error && <pre className="text-xs text-destructive whitespace-pre-wrap" role="alert">{error}</pre>}
      <p className="text-xs text-muted-foreground">PDFs are compiled by a public LaTeX service (latex.ytotech.com, or texlive.net as backup) when you click Download PDF.</p>
    </div>
  );
}
