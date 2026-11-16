/**
 * FileValue wire contract — the object branch carries an opaque `uploadToken`
 * (string) for a pending upload. The mirror of the php-ui schema is the source
 * the codegen reads, so the schema assertions guard the committed mirror and the
 * type assertions guard the generated TS type.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { FileValue } from "@/contracts/generated";

type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, { type?: string }>;
  required?: string[];
  additionalProperties?: boolean;
};

const SCHEMA_DIR = join(__dirname, "..", "..", "docs", "public", "schemas");
const SCHEMA_FILES = ["page-contract.json", "fragment.json"] as const;

function fileValueObjectBranch(file: string): JsonSchemaObject {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8")) as {
    $defs: { FileValue: { oneOf: JsonSchemaObject[] } };
  };
  const branch = schema.$defs.FileValue.oneOf.find((b) => b.type === "object");
  if (!branch) throw new Error(`${file}: FileValue has no object branch`);
  return branch;
}

describe("FileValue wire schema", () => {
  it.each(SCHEMA_FILES)("%s declares uploadToken as a string", (file) => {
    const branch = fileValueObjectBranch(file);
    expect(branch.properties?.uploadToken).toEqual({ type: "string" });
  });

  it.each(SCHEMA_FILES)("%s no longer declares draftitemid", (file) => {
    const branch = fileValueObjectBranch(file);
    expect(branch.properties).not.toHaveProperty("draftitemid");
  });

  it.each(SCHEMA_FILES)("%s keeps url required and rejects unknown keys", (file) => {
    const branch = fileValueObjectBranch(file);
    expect(branch.required).toEqual(["url"]);
    expect(branch.additionalProperties).toBe(false);
    expect(Object.keys(branch.properties ?? {}).sort()).toEqual(
      ["id", "name", "size", "type", "uploadToken", "url"].sort(),
    );
  });

  it("keeps the two schema files identical for FileValue", () => {
    expect(fileValueObjectBranch("page-contract.json")).toEqual(
      fileValueObjectBranch("fragment.json"),
    );
  });
});

describe("FileValue generated type", () => {
  it("accepts an object with a string uploadToken", () => {
    const value: FileValue = {
      url: "/f.pdf",
      name: "a.pdf",
      size: 2048,
      type: "application/pdf",
      id: "file-7",
      uploadToken: "99",
    };
    expect(value).toMatchObject({ uploadToken: "99" });
  });

  it("still accepts the bare-URL string shorthand", () => {
    const value: FileValue = "/f.pdf";
    expect(value).toBe("/f.pdf");
  });

  it("rejects a numeric uploadToken and the removed draftitemid at compile time", () => {
    // @ts-expect-error uploadToken is a string, not a number
    const numeric: FileValue = { url: "/f.pdf", uploadToken: 99 };
    // @ts-expect-error draftitemid is not part of the contract
    const legacy: FileValue = { url: "/f.pdf", draftitemid: 99 };
    expect([numeric, legacy]).toHaveLength(2);
  });
});
