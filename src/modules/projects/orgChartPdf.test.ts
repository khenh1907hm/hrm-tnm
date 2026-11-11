import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildFromProject } from "./orgChart";
import { A3_LANDSCAPE, renderOrgChartPdf } from "./orgChartPdf";
import type { ProjectMember } from "./types";

const read = (path: string) => new Uint8Array(readFileSync(join(process.cwd(), "public", path)));
const member = (id: string, role: ProjectMember["role"], parentId: string | null, name: string): ProjectMember => ({
  id, projectId: "p", employeeId: `E${id}`, displayName: name, employeeCode: id, role, parentId, team: "", subcontractId: null, joinedOn: "2026-01-01", leftOn: null,
});

describe("org chart PDF", () => {
  it("ORG_06 downloads the chart as a single A3 landscape PDF with Vietnamese text", async () => {
    let n = 0;
    const chart = buildFromProject(() => `id${++n}`, { customerName: "QBB Asia", name: "HVAC Control System" }, "2026-11-11", null,
      [member("p", "pm", null, "Trần Ngọc Đức"), member("c", "commander", "p", "Đoàn Hồng Thắm"), member("l", "leader", "c", "Phạm Thân Nhi"), member("w", "worker", "l", "Công Nhân")]);
    const bytes = await renderOrgChartPdf(chart, {
      regular: read("fonts/BeVietnamPro-Regular.ttf"), bold: read("fonts/BeVietnamPro-Bold.ttf"),
      italic: read("fonts/Be_Vietnam_Pro/BeVietnamPro-Italic.ttf"), boldItalic: read("fonts/Be_Vietnam_Pro/BeVietnamPro-BoldItalic.ttf"),
      logoLeft: read("org-chart/taikisha.png"), logoRight: read("org-chart/bsi.png"),
    }, new Date("2026-11-11T09:56:00+07:00"));
    if (process.env.ORG_PDF_OUT) writeFileSync(process.env.ORG_PDF_OUT, bytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(Math.round(A3_LANDSCAPE.width));
    expect(Math.round(height)).toBe(Math.round(A3_LANDSCAPE.height));
    expect(pdf.getTitle()).toBe("Sơ đồ tổ chức dự án");
  });
});
