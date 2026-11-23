import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme, getEffectiveTheme, type Appearance } from "@/base/theme/appearance";

describe("applyTheme — color-scheme sync", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("sets color-scheme=dark and .dark class when applying dark", () => {
    applyTheme("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("sets color-scheme=light and removes .dark class when applying light", () => {
    applyTheme("dark");
    applyTheme("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("mirrors data-theme onto .middag-root elements", () => {
    const root = document.createElement("div");
    root.className = "middag-root";
    document.body.appendChild(root);
    applyTheme("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    document.body.removeChild(root);
  });
});

describe("getEffectiveTheme", () => {
  it("passes light and dark through", () => {
    expect(getEffectiveTheme("light")).toBe("light");
    expect(getEffectiveTheme("dark")).toBe("dark");
  });

  it("resolves an unknown preference like system, never returning it", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const result = getEffectiveTheme("sepia" as Appearance);
    vi.unstubAllGlobals();
    expect(["light", "dark"]).toContain(result);
  });
});
