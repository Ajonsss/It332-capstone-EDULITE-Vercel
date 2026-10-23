import path from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";

// Read only the workbook data needed for import. Do not load images, styles,
// external links or VBA, or hydrate the template's thousands of formatted cells.
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 32 * 1024 * 1024;
const localName = (name) => name.split(":").at(-1);

function parseXml(xml, onOpen = () => {}, onText = () => {}, onClose = () => {}) {
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new Error("Document types are not supported."); });
  parser.on("opentag", (tag) => onOpen(localName(tag.name), tag.attributes));
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", (tag) => onClose(localName(tag.name)));
  parser.write(xml).close();
}

export async function openWorkbookXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let totalBytes = 0;
  async function read(name) {
    const entry = zip.file(name);
    if (!entry) throw new Error(`Missing workbook part: ${name}`);
    return new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      const stream = entry.internalStream("nodebuffer");
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        totalBytes += chunk.length;
        if (bytes > MAX_XML_BYTES || totalBytes > MAX_TOTAL_XML_BYTES) {
          stream.pause();
          reject(new Error("The expanded workbook data is too large."));
        } else chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.resume();
    });
  }
  const relations = new Map();
  parseXml(await read("xl/_rels/workbook.xml.rels"), (name, attrs) => {
    if (name === "Relationship" && attrs.TargetMode !== "External") {
      const target = attrs.Target.startsWith("/") ? attrs.Target.slice(1) : path.posix.join("xl", attrs.Target);
      if (target.startsWith("xl/")) relations.set(attrs.Id, { target, type: attrs.Type });
    }
  });
  const sheets = new Map();
  let date1904 = false;
  parseXml(await read("xl/workbook.xml"), (name, attrs) => {
    if (name === "workbookPr") date1904 = attrs.date1904 === "1" || attrs.date1904 === "true";
    if (name === "sheet") {
      if (sheets.has(attrs.name)) throw new Error("Duplicate worksheet names.");
      const relationId = Object.keys(attrs).find((key) => key.endsWith(":id"));
      const relation = relations.get(attrs[relationId]);
      if (!relation?.type.endsWith("/worksheet")) throw new Error("Invalid worksheet relationship.");
      sheets.set(attrs.name, relation.target);
    }
  });
  let strings;
  async function sharedStrings() {
    if (strings) return strings;
    strings = [];
    const target = [...relations.values()].find((rel) => rel.type.endsWith("/sharedStrings"))?.target;
    if (!target) return strings;
    let value = "", inText = false, phonetic = false;
    parseXml(await read(target), (name) => {
      if (name === "si") value = "";
      if (name === "rPh") phonetic = true;
      if (name === "t" && !phonetic) inText = true;
    }, (text) => { if (inText) value += text; }, (name) => {
      if (name === "t") inText = false;
      if (name === "rPh") phonetic = false;
      if (name === "si") strings.push(value);
    });
    return strings;
  }
  return { sheets, date1904, async cells(sheet, include = () => true) {
    const shared = await sharedStrings();
    const cells = new Map();
    let cell, part = "", phonetic = false;
    const sharedFormulas = new Map();
    parseXml(await read(sheets.get(sheet)), (name, attrs) => {
      if (name === "c" && include(attrs.r)) cell = { address: attrs.r, type: attrs.t, text: "" };
      if (!cell) return;
      if (name === "f") { cell.formula = true; cell.formulaText = ""; cell.sharedFormulaId = attrs.t === "shared" ? attrs.si : undefined; part = "formulaText"; }
      if (name === "rPh") phonetic = true;
      if (name === "v") { part = "value"; cell.value = ""; }
      if (name === "t" && !phonetic) part = "text";
    }, (text) => { if (cell && part) cell[part] += text; }, (name) => {
      if (name === "v" || name === "t" || name === "f") part = "";
      if (name === "rPh") phonetic = false;
      if (name !== "c" || !cell) return;
      if (cell.type === "s") cell.value = shared[Number(cell.value)];
      else if (cell.type === "inlineStr") cell.value = cell.text;
      else if ((!cell.type || cell.type === "n") && cell.value !== undefined && cell.value !== "") cell.value = Number(cell.value);
      if (cell.sharedFormulaId !== undefined) {
        if (cell.formulaText) sharedFormulas.set(cell.sharedFormulaId, { address: cell.address, text: cell.formulaText });
        else cell.formulaMaster = sharedFormulas.get(cell.sharedFormulaId);
      }
      cells.set(cell.address, cell);
      cell = undefined;
    });
    return cells;
  } };
}
