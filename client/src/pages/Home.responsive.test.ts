import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Home responsive layout contract", () => {
  const source = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

  it("includes mobile-first and larger-screen typography breakpoints for the hero", () => {
    expect(source).toContain("sm:text-[5.4rem]");
    expect(source).toContain("lg:text-[7.4rem]");
  });

  it("uses larger-screen grid layouts for the hero and dashboard sections", () => {
    expect(source).toContain("lg:grid-cols-[1.15fr_0.85fr]");
    expect(source).toContain("xl:grid-cols-[1.15fr_0.85fr]");
  });

  it("keeps key content blocks adaptive across smaller and larger screens", () => {
    expect(source).toContain("sm:h-80");
    expect(source).toContain("sm:p-6");
    expect(source).toContain("sm:grid-cols-3");
  });
});
