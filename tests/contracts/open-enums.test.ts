import { describe, expect, it } from "vitest";

import {
  ActionIntentSchema,
  FilterTypeSchema,
  HttpMethodSchema,
  ThemeModeSchema,
} from "@/contracts/generated/schemas";

describe("open enums", () => {
  it.each([
    ["ActionIntent", ActionIntentSchema],
    ["FilterType", FilterTypeSchema],
    ["ThemeMode", ThemeModeSchema],
  ])("%s keeps an unknown value as is", (_name, schema) => {
    const parsed = schema.safeParse("from-the-future");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("from-the-future");
  });
});

describe("strict control enums", () => {
  it("HttpMethod still rejects an unknown value", () => {
    expect(HttpMethodSchema.safeParse("teleport").success).toBe(false);
  });

  it("HttpMethod still accepts a known value", () => {
    expect(HttpMethodSchema.safeParse("post").success).toBe(true);
  });
});
