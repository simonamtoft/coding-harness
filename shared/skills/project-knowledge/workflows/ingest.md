# Ingest documents

Turn client files into Markdown the agent can read, keeping the original beside it.

1. **Copy each file into `context/sources/`** under its dated kebab-case name. Ask for the date only when neither the file nor the user gives one. Do not move the user's file out of its original location.
2. **Convert it:**

   ```bash
   <skill>/scripts/convert.sh context/sources/2026-11-05-steerco.pptx "SteerCo Nov v3 FINAL.pptx"
   ```

   The second argument is the file's name before you renamed it; omit it when unchanged.

   The script writes `2026-11-05-steerco.md` next to the original and refuses to overwrite an existing conversion. Handles `.pptx`, `.docx`, `.xlsx`, `.xls` and `.pdf`. Files that are already text (`.md`, `.txt`, `.csv`) need no conversion.
3. **Check the conversion against what it cannot carry:**
   - A `warning: almost no text extracted` line usually means a scanned PDF or a slide of pictures. Tell the user; there is no OCR here.
   - Charts and diagrams become their labels at best, and images are dropped. Name the slides or pages where that loses the message.
   - Spreadsheets arrive one table per sheet with values, not formulas.
4. **Report** each file added, its word count, and anything step 3 found. Do not summarise the content unless asked; the conversion is now readable in place.

To reconvert after a fix or a new version of the same document, delete the old `.md` first. A new version of a document that changed in substance gets its own dated file, so earlier references stay valid.
