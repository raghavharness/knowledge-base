import { describe, it, expect } from "vitest";
import { assessQuality, type IngestionRecord } from "./quality.js";

function makeRecord(overrides: Partial<IngestionRecord> = {}): IngestionRecord {
  return {
    source_type: "jira_ticket",
    ticket_id: "CI-100",
    ticket_summary: "Fix null pointer",
    ticket_created_at: "2024-01-01T00:00:00Z",
    pr_url: "https://github.com/org/repo/pull/1",
    pr_title: "Fix null check",
    pr_repo: "org/repo",
    category: "bugfix",
    extraction_confidence: 0.9,
    has_clear_error: true,
    has_clear_fix: true,
    ...overrides,
  };
}

describe("assessQuality", () => {
  it("returns tier 1 for high quality records", () => {
    const result = assessQuality(makeRecord());
    expect(result.tier).toBe(1);
    expect(result.skip).toBe(false);
  });

  it("skips records with extraction_confidence below 0.3", () => {
    const result = assessQuality(makeRecord({ extraction_confidence: 0.2 }));
    expect(result.skip).toBe(true);
    expect(result.tier).toBe(3);
  });

  it("returns tier 2 for medium quality (PR with files but unclear error)", () => {
    const result = assessQuality(
      makeRecord({
        has_clear_error: false,
        extraction_confidence: 0.6,
        pr_files_changed: [{ path: "src/main.ts", change_type: "modified", summary: "fix" }],
      }),
    );
    expect(result.tier).toBe(2);
    expect(result.skip).toBe(false);
  });

  it("returns tier 3 for low quality records", () => {
    const result = assessQuality(
      makeRecord({
        has_clear_error: false,
        has_clear_fix: false,
        extraction_confidence: 0.4,
      }),
    );
    expect(result.tier).toBe(3);
    expect(result.skip).toBe(false);
  });

  it("returns tier 2 when has_clear_fix is false but PR has files", () => {
    const result = assessQuality(
      makeRecord({
        has_clear_fix: false,
        extraction_confidence: 0.7,
        pr_files_changed: [{ path: "a.ts", change_type: "added", summary: "new" }],
      }),
    );
    expect(result.tier).toBe(2);
  });

  it("confidence at exactly 0.3 is not skipped", () => {
    const result = assessQuality(makeRecord({ extraction_confidence: 0.3 }));
    expect(result.skip).toBe(false);
  });
});
