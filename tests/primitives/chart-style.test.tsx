import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../setup";

import { ChartContainer, type ChartConfig } from "@/primitives/reui/chart";

function styleText(config: ChartConfig, id?: string): string {
  const { container } = render(
    <ChartContainer id={id} config={config}>
      <div />
    </ChartContainer>,
  );
  return container.querySelector("style")?.textContent ?? "";
}

describe("ChartContainer colour style", () => {
  afterEach(() => cleanup());

  it("emits a custom property per configured colour", () => {
    const css = styleText({ revenue: { color: "oklch(0.6 0.2 250)" } }, "sales");
    expect(css).toContain("[data-chart=chart-sales]");
    expect(css).toContain("--color-revenue: oklch(0.6 0.2 250);");
  });

  it("drops a colour that would break out of the declaration", () => {
    const css = styleText({
      revenue: { color: "red;} body { display: none" },
      cost: { color: "#f00" },
    });
    expect(css).not.toContain("display: none");
    expect(css).not.toContain("--color-revenue");
    expect(css).toContain("--color-cost: #f00;");
  });

  it("drops a key that is not a plain identifier", () => {
    const css = styleText({ "x:1}body{": { color: "#f00" }, ok: { color: "#0f0" } });
    expect(css).not.toContain("body");
    expect(css).toContain("--color-ok: #0f0;");
  });

  it("closes no style element early from a hostile colour", () => {
    const { container } = render(
      <ChartContainer config={{ a: { color: "</style><img src=x onerror=alert(1)>" } }}>
        <div />
      </ChartContainer>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });

  it("strips selector-breaking characters from the chart id", () => {
    const { container } = render(
      <ChartContainer id={"a] body {x:y} [b"} config={{ ok: { color: "#0f0" } }}>
        <div />
      </ChartContainer>,
    );
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).not.toContain("body {");
    const chartId = container.querySelector("[data-slot=chart]")?.getAttribute("data-chart");
    expect(chartId).toMatch(/^chart-[\w-]+$/);
    expect(css).toContain(`[data-chart=${chartId}]`);
  });
});
