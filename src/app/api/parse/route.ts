import { extractText, getDocumentProxy } from "unpdf";

export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;

// Turns an uploaded PDF into plain text. Scanned PDFs without a text layer
// come back empty: OCR is out of scope for this demo.
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "file too large (8 MB max)" }, { status: 413 });
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    return Response.json({ pages: totalPages, text: pages.join("\n\n") });
  } catch {
    return Response.json({ error: "could not read this PDF" }, { status: 422 });
  }
}
