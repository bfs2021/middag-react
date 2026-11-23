/**
 * BasicShell navigation links — an internal href goes through Inertia with
 * prefetch; an absolute http(s) href, or any node with a `target`, renders a
 * plain anchor with no prefetch and a safe 'rel'.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../setup";

import { BasicShell } from "@/base/shell/BasicShell";
import type { NavigationNode } from "@/contracts/navigation";
import { I18nProvider } from "@/i18n/I18nProvider";

import { mockUsePage } from "../setup";

function renderNav(tree: NavigationNode[]) {
  mockUsePage.mockReturnValue({
    props: {
      theme: { appearance: "light", strings: {} },
      flash: {},
      locale: "en",
      scope: {},
      navigation: { tree, activeKey: "", footer: [] },
    },
    url: "/dashboard",
  });

  return render(
    <I18nProvider>
      <BasicShell>
        <div>content</div>
      </BasicShell>
    </I18nProvider>,
  );
}

describe("BasicShell navigation links", () => {
  afterEach(cleanup);

  it("keeps an internal href on the Inertia link with prefetch", () => {
    renderNav([{ key: "home", label: "Home", href: "/home" }]);
    const link = screen.getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/home");
    expect(link.getAttribute("prefetch")).toBe("hover");
    expect(link.getAttribute("target")).toBeNull();
  });

  it.each([
    ["https://example.com/docs", "https absolute"],
    ["http://example.com/docs", "http absolute"],
    ["HTTPS://example.com/docs", "uppercase scheme"],
  ])("renders %s (%s) as a plain anchor without prefetch", (href) => {
    renderNav([{ key: "ext", label: "Docs", href }]);
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.getAttribute("href")).toBe(href);
    expect(link.getAttribute("prefetch")).toBeNull();
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders an internal href with a target as a plain anchor opening in that target", () => {
    renderNav([{ key: "help", label: "Help", href: "/help", target: "_blank" }]);
    const link = screen.getByRole("link", { name: "Help" });
    expect(link.getAttribute("href")).toBe("/help");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("prefetch")).toBeNull();
  });

  it("does not treat a path that merely contains 'http' as external", () => {
    renderNav([{ key: "x", label: "Proxy", href: "/http://nope" }]);
    const link = screen.getByRole("link", { name: "Proxy" });
    expect(link.getAttribute("prefetch")).toBe("hover");
  });
});
