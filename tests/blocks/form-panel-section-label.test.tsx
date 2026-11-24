import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../setup";

import type { FormPanelBlockData, FormSchemaNode } from "@/contracts/block-data";

import { block } from "../helpers";

const dataWithSectionLabel = (label: string | { key: string; domain: string } | null) =>
  ({
    action: "/api/x",
    method: "post",
    schema: [
      {
        kind: "section",
        id: "details",
        label,
        children: [
          { kind: "field", key: "name", component: "text", props: { label: "Name" } },
        ] satisfies FormSchemaNode[],
      },
    ],
    values: {},
    errors: {},
    meta: { submitLabel: "Save" },
  }) satisfies FormPanelBlockData;

async function renderPanel(label: string | { key: string; domain: string } | null) {
  const { FormPanelBlock } = await import("@/base/blocks/FormPanelBlock");
  const { I18nProvider } = await import("@/i18n/I18nProvider");
  render(
    <I18nProvider>
      <FormPanelBlock block={block("form_panel", "section-label", dataWithSectionLabel(label))} />
    </I18nProvider>,
  );
}

describe("FormPanelBlock section label", () => {
  afterEach(cleanup);

  it("renders a string label", async () => {
    await renderPanel("Details");
    expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
  });

  it("renders a translatable label without crashing, falling back to its key", async () => {
    await renderPanel({ key: "form.details_heading", domain: "local_middag" });
    expect(screen.getAllByText("form.details_heading").length).toBeGreaterThan(0);
  });

  it("renders a null label as an untitled section", async () => {
    await renderPanel(null);
    expect(screen.getByText("Name")).toBeDefined();
  });
});
