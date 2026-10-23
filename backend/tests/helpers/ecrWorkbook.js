import fs from "node:fs/promises";
import JSZip from "jszip";

export const templateUrl = new URL("../../../frontend/public/templates/trimester-ecr-grades-4-10.xlsm", import.meta.url);
// In-memory test fixtures only; the downloadable XLSM is never rewritten.
export async function ecrWorkbook(changes = {}, transform) {
  const zip = await JSZip.loadAsync(await fs.readFile(templateUrl));
  const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const [sheet, cells] of Object.entries(changes)) {
    const file = `xl/worksheets/sheet${sheet}.xml`;
    let xml = await zip.file(file).async("string");
    for (const [address, value] of Object.entries(cells)) {
      let content;
      if (value && typeof value === "object") {
        const type = typeof value.result === "number" ? "" : ' t="str"';
        content = `<c r="${address}"${type}><f>${escape(value.formula ?? "1+1")}</f>${value.result === undefined ? "" : `<v>${escape(value.result)}</v>`}</c>`;
      } else if (typeof value === "number") content = `<c r="${address}"><v>${value}</v></c>`;
      else content = `<c r="${address}" t="inlineStr"><is><t>${escape(value ?? "")}</t></is></c>`;
      const pattern = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      if (!pattern.test(xml)) throw new Error(`No fixture cell ${sheet}!${address}`);
      xml = xml.replace(pattern, content);
    }
    zip.file(file, xml);
  }
  if (transform) await transform(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function completedTerm(row, name, grade) {
  return {
    [`B${row}`]: { formula: `INPUT!B${row}`, result: name },
    [`AA${row}`]: { formula: `ROUND(999,0)`, result: grade },
    ...Object.fromEntries(["F", "G", "N", "T", "U", "V"].flatMap((column) => [
      [`${column}10`, 100], [`${column}${row}`, 80],
    ])),
  };
}
