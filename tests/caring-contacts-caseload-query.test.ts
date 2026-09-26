// tests/caring-contacts-caseload-query.test.ts
import { describe, expect, it } from "vitest";

import { paginateCaseload, queryCaseload, type CaseloadRecord } from "@/lib/caring-contacts/caseload-query";

function mockPatients(count: number): CaseloadRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    patientId: `PATIENT-${i + 1}`,
    patientName: `Patient ${i + 1}`,
    planId: `PLAN-${i + 1}`,
    referralId: `REF-${i + 1}`,
    state: i % 2 === 0 ? "active" : "draft",
  }));
}

describe("Task 2 #LM33K2: Caseload pagination boundary condition", () => {
  it("does not drop the patient on an exact page-size count (totalCount === pageSize)", () => {
    // 10 patients with pageSize 10
    const patients = mockPatients(10);
    const result = paginateCaseload(patients, { page: 1, pageSize: 10 });

    expect(result.totalCount).toBe(10);
    expect(result.items).toHaveLength(10);
    expect(result.items[9].patientId).toBe("PATIENT-10");
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it("does not drop the last patient on a multi-page exact boundary (e.g. 20 patients, pageSize 10)", () => {
    const patients = mockPatients(20);

    // Page 1
    const page1 = paginateCaseload(patients, { page: 1, pageSize: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0].patientId).toBe("PATIENT-1");
    expect(page1.items[9].patientId).toBe("PATIENT-10");
    expect(page1.hasNextPage).toBe(true);

    // Page 2
    const page2 = paginateCaseload(patients, { page: 2, pageSize: 10 });
    expect(page2.items).toHaveLength(10);
    expect(page2.items[0].patientId).toBe("PATIENT-11");
    expect(page2.items[9].patientId).toBe("PATIENT-20");
    expect(page2.hasNextPage).toBe(false);
    expect(page2.hasPreviousPage).toBe(true);
  });

  it("handles exact count when pageSize is 1", () => {
    const patients = mockPatients(1);
    const result = paginateCaseload(patients, { page: 1, pageSize: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].patientId).toBe("PATIENT-1");
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
  });

  it("handles empty items array cleanly", () => {
    const result = paginateCaseload([], { page: 1, pageSize: 10 });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it("handles pagination beyond the last page safely (adversarial check)", () => {
    const patients = mockPatients(15); // totalPages = 2
    const result = paginateCaseload(patients, { page: 5, pageSize: 10 });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(15);
    expect(result.page).toBe(5);
    expect(result.totalPages).toBe(2);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);
  });

  it("handles totalCount + 1 boundary correctly (e.g. 11 patients, pageSize 10)", () => {
    const patients = mockPatients(11);

    // Page 1 should have 10 patients
    const page1 = paginateCaseload(patients, { page: 1, pageSize: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.totalPages).toBe(2);
    expect(page1.hasNextPage).toBe(true);
    expect(page1.hasPreviousPage).toBe(false);

    // Page 2 should have the remaining 1 patient (PATIENT-11)
    const page2 = paginateCaseload(patients, { page: 2, pageSize: 10 });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].patientId).toBe("PATIENT-11");
    expect(page2.hasNextPage).toBe(false);
    expect(page2.hasPreviousPage).toBe(true);

    // Page 3 is out of bounds
    const page3 = paginateCaseload(patients, { page: 3, pageSize: 10 });
    expect(page3.items).toHaveLength(0);
    expect(page3.hasNextPage).toBe(false);
    expect(page3.hasPreviousPage).toBe(true);
  });

  it("handles out-of-bounds page request on empty dataset without false hasPreviousPage", () => {
    const result = paginateCaseload([], { page: 5, pageSize: 10 });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it("normalizes negative or zero page / pageSize", () => {
    const patients = mockPatients(5);
    const result = paginateCaseload(patients, { page: -1, pageSize: 0 });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10); // fallback to default
    expect(result.items).toHaveLength(5);
  });

  it("normalizes fractional page numbers and fractional page sizes safely", () => {
    const patients = mockPatients(25);

    // Fractional page < 1 (e.g. 0.5) must normalize to 1, not 0
    const subOnePage = paginateCaseload(patients, { page: 0.5, pageSize: 10 });
    expect(subOnePage.page).toBe(1);
    expect(subOnePage.items).toHaveLength(10);
    expect(subOnePage.items[0].patientId).toBe("PATIENT-1");

    // Fractional page > 1 (e.g. 2.7) floors to page 2
    const fractionalPage = paginateCaseload(patients, { page: 2.7, pageSize: 10 });
    expect(fractionalPage.page).toBe(2);
    expect(fractionalPage.items).toHaveLength(10);
    expect(fractionalPage.items[0].patientId).toBe("PATIENT-11");

    // Fractional pageSize < 1 (e.g. 0.5) must fallback to default, avoiding division by zero / Infinity
    const subOnePageSize = paginateCaseload(patients, { page: 1, pageSize: 0.5 });
    expect(subOnePageSize.pageSize).toBe(10);
    expect(Number.isFinite(subOnePageSize.totalPages)).toBe(true);
    expect(subOnePageSize.totalPages).toBe(3);

    // Fractional pageSize >= 1 (e.g. 10.9) floors to 10
    const fractionalPageSize = paginateCaseload(patients, { page: 1, pageSize: 10.9 });
    expect(fractionalPageSize.pageSize).toBe(10);
    expect(fractionalPageSize.items).toHaveLength(10);
  });
});

describe("queryCaseload search and filtering", () => {
  const patients: CaseloadRecord[] = [
    { patientId: "P-01", patientName: "Alice Walker", planId: "PLAN-A", state: "active" },
    { patientId: "P-02", patientName: "Bob Smith", planId: "PLAN-B", state: "draft" },
    { patientId: "P-03", patientName: "Charlie Brown", planId: "PLAN-C", state: "active" },
  ];

  it("filters by patient name", () => {
    const result = queryCaseload(patients, { query: "alice" });
    expect(result.totalCount).toBe(1);
    expect(result.items[0].patientName).toBe("Alice Walker");
  });

  it("filters by synthetic ID", () => {
    const result = queryCaseload(patients, { query: "PLAN-B" });
    expect(result.totalCount).toBe(1);
    expect(result.items[0].patientId).toBe("P-02");
  });

  it("filters by plan state", () => {
    const result = queryCaseload(patients, { state: "active" });
    expect(result.totalCount).toBe(2);
    expect(result.items.map((i) => i.patientId)).toEqual(["P-01", "P-03"]);
  });

  it("handles empty search query returning all matching state records", () => {
    const result = queryCaseload(patients, { query: "   ", state: "all" });
    expect(result.totalCount).toBe(3);
    expect(result.items).toHaveLength(3);
  });
});
