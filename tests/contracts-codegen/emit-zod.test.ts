import { describe, expect, it } from "vitest";

import { emitZod } from "../../packages/contracts-codegen/lib/index.mjs";

const emit = (defs: Record<string, unknown>, extra: Partial<Parameters<typeof emitZod>[0]> = {}) =>
  emitZod({ defs, typesModule: "./types.js", ...extra });

describe("emitZod", () => {
  it("emits a strict enum, with no catch, by default", () => {
    const { body } = emit({ Level: { enum: ["info", "warn"] } });
    expect(body).toContain('z.enum(["info", "warn"])');
    expect(body).not.toContain(".catch(");
  });

  it("emits a union with z.string() for an open enum", () => {
    const { body } = emit({ Level: { enum: ["info", "warn"] } }, { openEnums: ["Level"] });
    expect(body).toContain('z.union([z.enum(["info", "warn"]), z.string()])');
    expect(body).not.toContain(".catch(");
  });

  it("keeps an inline enum strict even when its owner is open", () => {
    const { body } = emit(
      {
        Level: { enum: ["info"] },
        Box: { type: "object", properties: { kind: { enum: ["a", "b"] } } },
      },
      { openEnums: ["Level"] },
    );
    expect(body).toContain('"kind": z.enum(["a", "b"]).optional()');
  });

  it("rejects an open enum that is not a top-level string enum", () => {
    expect(() => emit({ Box: { type: "object" } }, { openEnums: ["Box"] })).toThrow(/openEnums/);
    expect(() => emit({}, { openEnums: ["Missing"] })).toThrow(/openEnums/);
  });

  it("declares dependencies before dependents", () => {
    const { order } = emit({
      Page: { type: "object", properties: { label: { $ref: "#/$defs/Label" } } },
      Label: { type: "string" },
    });
    expect(order).toEqual(["Label", "Page"]);
  });

  it("defers a recursive reference and annotates its type", () => {
    const { body, recursive } = emit({
      Node: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string" },
          children: { type: "array", items: { $ref: "#/$defs/Node" } },
        },
      },
    });
    expect(recursive).toEqual(["Node"]);
    expect(body).toContain('import type { Node } from "./types.js";');
    expect(body).toContain("export const NodeSchema: z.ZodType<Node> = z.object({");
    expect(body).toContain("z.array(z.lazy(() => NodeSchema)).optional()");
  });

  it("imports a $ref of another contracts package", () => {
    const { body } = emit(
      {
        Panel: {
          type: "object",
          properties: {
            schema: {
              $ref: "https://ui-docs.middag.io/schemas/page-contract.json#/$defs/FormSchemaNode",
            },
          },
        },
      },
      { externals: { "https://ui-docs.middag.io/": "@middag-io/ui-contracts" } },
    );
    expect(body).toContain('import { FormSchemaNodeSchema } from "@middag-io/ui-contracts";');
    expect(body).toContain('"schema": FormSchemaNodeSchema.optional()');
  });

  it("refuses a $ref it cannot resolve", () => {
    expect(() => emit({ A: { $ref: "https://elsewhere.test/x.json#/$defs/B" } })).toThrow(
      /unsupported \$ref/,
    );
    expect(() => emit({ A: { $ref: "#/$defs/Missing" } })).toThrow(/unknown \$ref target/);
  });

  it("keeps the constraints the wire schemas use", () => {
    const { body } = emit({
      Base: { type: "object", properties: { id: { type: "integer" } } },
      Props: {
        allOf: [
          { $ref: "#/$defs/Base" },
          { type: "object", properties: { name: { type: "string", maxLength: 3 } } },
        ],
      },
      Empty: { type: "array", maxItems: 0 },
      Open: { type: "object", properties: { a: { type: "string" } }, additionalProperties: true },
      Map: { type: "object", additionalProperties: { type: "boolean" } },
      Nullable: { type: ["string", "null"] },
    });
    expect(body).toContain('"id": z.number().int().optional()');
    expect(body).toContain("export const PropsSchema = z.intersection(BaseSchema, z.object({");
    expect(body).toContain('"name": z.string().max(3).optional()');
    expect(body).toContain("export const EmptySchema = z.array(z.unknown()).max(0);");
    expect(body).toContain("}).catchall(z.unknown());");
    expect(body).toContain("export const MapSchema = z.record(z.string(), z.boolean());");
    expect(body).toContain("export const NullableSchema = z.union([z.string(), z.null()]);");
  });

  it("exports aliases and rejects one without a target", () => {
    const { body } = emit({ Page: { type: "string" } }, { aliases: { pageSchemaCore: "Page" } });
    expect(body).toContain("export const pageSchemaCore = PageSchema;");
    expect(() => emit({ Page: { type: "string" } }, { aliases: { x: "Nope" } })).toThrow(
      /unknown def/,
    );
  });
});
