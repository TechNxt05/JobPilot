import * as pdfjs from "pdfjs-dist";
import { cleanResumeText, itemsToText, type PdfTextItem } from "@internova/core";

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");

/**
 * Extract a resume PDF locally: text with line breaks (spaces rebuilt from glyph gaps, icon glyphs removed)
 * plus the PDF's clickable links (LinkedIn, GitHub, project and paper URLs).
 */
export async function pdfToText(file: File): Promise<{ text: string; links: string[] }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfTextItem[][] = [];
  const links: string[] = [];
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
  await doc.destroy();
  return { text: cleanResumeText(itemsToText(pages)), links };
}
