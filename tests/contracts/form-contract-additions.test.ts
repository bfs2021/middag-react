/**
 * Wire-contract additions: richtext/time/autocomplete form components and
 * translatable-or-null section labels, validated through the generated zod schemas.
 */
import { describe, expect, it } from "vitest";

import { FormComponentSchema, FormSchemaNodeSchema } from "@/contracts/generated/schemas";

const baseProps = { label: "Field", required: false };

describe("FormComponentSchema", () => {
  it.each(["richtext", "time", "autocomplete"])("accepts %s", (component) => {
    expect(FormComponentSchema.safeParse(component).success).toBe(true);
  });

  it("degrades an unknown component to the first member", () => {
    const parsed = FormComponentSchema.safeParse("wysiwyg");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("text");
  });
});

describe("form field nodes for the new components", () => {
  it.each(["richtext", "time"])("accepts a %s field", (component) => {
    const node = { kind: "field", key: "f", component, props: baseProps };
    expect(FormSchemaNodeSchema.safeParse(node).success).toBe(true);
  });

  it("accepts an autocomplete field with options", () => {
    const node = {
      kind: "field",
      key: "city",
      component: "autocomplete",
      props: { ...baseProps, options: [{ value: "a", label: "A" }] },
    };
    expect(FormSchemaNodeSchema.safeParse(node).success).toBe(true);
  });
});

describe("form section label", () => {
  const section = (label: unknown) => ({ kind: "section", id: "s", label, children: [] });

  it.each([
    ["a string", "Details"],
    ["a translatable", { key: "form.details", domain: "local_middag" }],
    ["null", null],
  ])("accepts %s", (_name, label) => {
    expect(FormSchemaNodeSchema.safeParse(section(label)).success).toBe(true);
  });

  it.each([
    ["a number", 3],
    ["a translatable without a key", { domain: "local_middag" }],
  ])("rejects %s", (_name, label) => {
    expect(FormSchemaNodeSchema.safeParse(section(label)).success).toBe(false);
  });
});
