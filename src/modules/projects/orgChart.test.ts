import { describe, expect, it } from "vitest";
import {
  blankPerson, defaultOrgChart, fillFromMembers, layoutOrgChart, orgChartIssue, ORG_CANVAS, signDateText, suggestEmail, toCompanyTemplate, type OrgPerson,
} from "./orgChart";
import type { ProjectMember } from "./types";

const ids = () => { let n = 0; return () => `id${++n}`; };
const project = { customerName: "QBB Asia Co.,Ltd. Factory", name: "HVAC Control System" };
const member = (id: string, role: ProjectMember["role"], parentId: string | null, name = id): ProjectMember => ({
  id, projectId: "p", employeeId: `E${id}`, displayName: name, employeeCode: id, role, parentId, team: "", subcontractId: null, joinedOn: "2026-01-01", leftOn: null,
});

describe("subcontractor org chart", () => {
  it("ORG_01 new charts default to director Nguyễn Gia Luân and THIENNHATMINH CO.LTD, or the saved company template", () => {
    const chart = defaultOrgChart(ids(), project, "2026-11-11");
    expect(chart.header.contractor).toBe("THIENNHATMINH CO.LTD");
    expect(chart.header.client).toBe("QBB ASIA CO.,LTD. FACTORY");
    expect(chart.people[0]).toMatchObject({ section: "office", branch: "main", titleEn: "Director", name: "NGUYỄN GIA LUÂN", phone: "0983449446", color: "blue" });
    expect(chart.people.map((person) => person.branch)).toEqual(["main", "main", "left", "group"]);
    const template = toCompanyTemplate({ ...chart, header: { ...chart.header, contractor: "TNM" }, people: [...chart.people, blankPerson("x", "office", "right", "Technical Support")] });
    expect(template.header.client).toBe("");
    expect(template.people.every((person) => person.section === "office")).toBe(true);
    const next = defaultOrgChart(ids(), { customerName: "ABC", name: "X" }, "2026-12-01", template);
    expect(next.header).toMatchObject({ contractor: "TNM", client: "ABC", signDate: "2026-12-01" });
    expect(next.people.filter((person) => person.section === "office").map((person) => person.titleEn)).toEqual(["Director", "Technical Support"]);
  });

  it("ORG_02 suggests company emails from names and formats the sign date", () => {
    expect(suggestEmail("Nguyễn Gia Luân", "thiennhatminh.com")).toBe("ng.luan@thiennhatminh.com");
    expect(suggestEmail("LÊ VĂN THẠCH", "thiennhatminh.com")).toBe("lv.thach@thiennhatminh.com");
    expect(suggestEmail("Đoàn Hồng Thắm", "tnm.vn")).toBe("dh.tham@tnm.vn");
    expect(suggestEmail("", "x.com")).toBe("");
    expect(signDateText("2026-07-10")).toBe("Ngày 10 tháng 07 năm 2026");
  });

  it("ORG_03 lays out office above the Head Office line, branches beside the trunk, group leaders on one row inside the page", () => {
    const people: OrgPerson[] = [
      blankPerson("d", "office", "main", "Director"), blankPerson("m", "office", "main", "Auto Control Manager"), blankPerson("t", "office", "right", "Technical Support"),
      blankPerson("s", "site", "main", "Site Manager"), blankPerson("a", "site", "left", "Safety Staff"),
      ...[1, 2, 3, 4].map((n) => blankPerson(`g${n}`, "site", "group")),
    ];
    const layout = layoutOrgChart(people);
    const box = (id: string) => layout.boxes.find((item) => item.person.id === id)!;
    expect(box("m").y).toBeGreaterThan(box("d").y);
    expect(box("t").x).toBeGreaterThan(box("d").x + box("d").w);
    expect(box("m").y + box("m").h).toBeLessThan(layout.headOfficeY);
    expect(box("s").y).toBeGreaterThan(layout.headOfficeY);
    expect(box("a").x + box("a").w).toBeLessThan(box("s").x);
    const groups = ["g1", "g2", "g3", "g4"].map(box);
    expect(new Set(groups.map((item) => item.y)).size).toBe(1);
    expect(groups.every((item) => item.x >= 0 && item.x + item.w <= ORG_CANVAS.width)).toBe(true);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThanOrEqual(1);
  });

  it("ORG_04 fills group leaders with worker counts from the project tree and validates before saving", () => {
    const chart = defaultOrgChart(ids(), project, "2026-11-11");
    const members = [member("c", "commander", null, "Trần Chỉ Huy"), member("l1", "leader", "c", "Phạm Thân Nhi"), member("w1", "worker", "l1"), member("w2", "worker", "l1"), member("l2", "leader", "c", "Lê Tổ"), member("w3", "worker", "l2")];
    const filled = fillFromMembers(chart, members, ids(), "2026-11-11");
    const groups = filled.people.filter((person) => person.branch === "group");
    expect(groups.map((person) => [person.titleEn, person.name, person.workerCount])).toEqual([["Group Leader #1", "PHẠM THÂN NHI", 2], ["Group Leader #2", "LÊ TỔ", 1]]);
    expect(filled.people.find((person) => person.section === "site" && person.branch === "main")?.name).toBe("TRẦN CHỈ HUY");
    expect(orgChartIssue(filled)).toBeNull();
    expect(orgChartIssue({ ...filled, people: filled.people.map((person, index) => index === 0 ? { ...person, email: "sai" } : person) })).toMatch(/Email/);
  });
});
