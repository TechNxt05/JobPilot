"use client";

import { cleanResumeText, itemsToText, type PdfTextItem } from "@internova/core";

/**
 * Read a resume PDF in the browser (pdf.js): text with spaces rebuilt from glyph gaps, icon glyphs removed,
 * plus the PDF's clickable links. Nothing is uploaded to a server for this.
 */
export async function readResumePdf(file: File): Promise<{ text: string; links: string[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfTextItem[][] = [];
  const links: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const [a, b, , , x, y] = item.transform as number[];
        items.push({ str: item.str, x, y, width: item.width, size: Math.hypot(a, b) || 10, hasEOL: item.hasEOL });
      }
      pages.push(items);
      for (const ann of await page.getAnnotations()) if (typeof ann.url === "string") links.push(ann.url);
    }
  } finally {
    await doc.destroy();
  }
  return { text: cleanResumeText(itemsToText(pages)), links };
}
