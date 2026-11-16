/**
 * Turns an untrusted HTML string into React elements through an allowlist.
 *
 * `html` columns carry markup that comes from row data, so it is never handed
 * to the DOM as a raw string. The string is parsed into a syntax tree,
 * filtered by the GitHub-style default schema of `hast-util-sanitize`
 * (no `<script>`, `<style>`, event handlers, inline styles or `javascript:`
 * URLs), and rendered as ordinary React elements. Parsing does not need a DOM,
 * so the same path works during server rendering.
 *
 * `className` is allowed on every element on top of the default schema: host
 * markup commonly styles badges and labels with classes, and a class cannot
 * run code.
 */

import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";

type AttributeList = NonNullable<Schema["attributes"]>[string];

// The default schema pins `className` to fixed values on a few elements (for
// example `a` only accepts `data-footnote-backref`), and a per-element rule
// wins over `*`. Those value pins are dropped so the `*` rule applies.
function withoutClassNamePins(list: AttributeList): AttributeList {
  return list.filter((entry) => !(Array.isArray(entry) && entry[0] === "className"));
}

const CELL_HTML_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: Object.fromEntries([
    ...Object.entries(defaultSchema.attributes ?? {})
      .filter(([tag]) => tag !== "*")
      .map(([tag, list]) => [tag, withoutClassNamePins(list)]),
    ["*", [...(defaultSchema.attributes?.["*"] ?? []), "className"]],
  ]),
};

export function sanitizeHtmlToReact(html: string): ReactNode {
  const tree = fromHtml(html, { fragment: true });
  const clean = sanitize(tree, CELL_HTML_SCHEMA);
  return toJsxRuntime(clean, { Fragment, jsx, jsxs });
}
