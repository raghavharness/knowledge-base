import { describe, it, expect } from "vitest";
import { isValidPrUrl, extractPrNumber, extractRepoFromUrl, extractRepoUrl } from "./url-utils.js";

describe("isValidPrUrl", () => {
  it("accepts GitHub PR URLs", () => {
    expect(isValidPrUrl("https://github.com/org/repo/pull/123")).toBe(true);
  });

  it("accepts Harness Code pulls URLs", () => {
    expect(isValidPrUrl("https://app.harness.io/ng/account/abc/module/code/repos/my-repo/pulls/42")).toBe(true);
  });

  it("accepts Harness Code pullreq URLs", () => {
    expect(isValidPrUrl("https://app.harness.io/code/repos/my-repo/pullreq/7")).toBe(true);
  });

  it("rejects JIRA URLs", () => {
    expect(isValidPrUrl("https://jira.atlassian.com/browse/CI-1234")).toBe(false);
  });

  it("rejects Confluence URLs", () => {
    expect(isValidPrUrl("https://wiki.atlassian.com/pages/viewpage.action?pageId=123")).toBe(false);
  });

  it("rejects plain text", () => {
    expect(isValidPrUrl("not-a-url")).toBe(false);
  });
});

describe("extractPrNumber", () => {
  it("extracts number from GitHub PR URL", () => {
    expect(extractPrNumber("https://github.com/org/repo/pull/456")).toBe("456");
  });

  it("extracts number from Harness pulls URL", () => {
    expect(extractPrNumber("https://app.harness.io/code/repos/my-repo/pulls/78")).toBe("78");
  });

  it("extracts number from Harness pullreq URL", () => {
    expect(extractPrNumber("https://app.harness.io/code/repos/my-repo/pullreq/99")).toBe("99");
  });

  it("returns '0' for non-matching URLs", () => {
    expect(extractPrNumber("https://example.com")).toBe("0");
  });
});

describe("extractRepoFromUrl", () => {
  it("extracts owner/repo from GitHub URL", () => {
    expect(extractRepoFromUrl("https://github.com/myorg/myrepo/pull/1")).toBe("myorg/myrepo");
  });

  it("extracts repo name from Harness URL", () => {
    expect(extractRepoFromUrl("https://app.harness.io/code/repos/my-service/pulls/5")).toBe("my-service");
  });

  it("returns empty string for unknown URLs", () => {
    expect(extractRepoFromUrl("https://example.com/something")).toBe("");
  });
});

describe("extractRepoUrl", () => {
  it("extracts GitHub repo URL from PR URL", () => {
    expect(extractRepoUrl("https://github.com/org/repo/pull/123")).toBe("https://github.com/org/repo");
  });

  it("returns empty string for non-GitHub URLs", () => {
    expect(extractRepoUrl("https://app.harness.io/code/repos/svc/pulls/1")).toBe("");
  });
});
