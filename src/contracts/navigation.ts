/**
 * Navigation contract — typed shape for the `navigation` Inertia shared prop.
 *
 * Unified tree model.
 * PHP serializes this from navigation_registry during boot().
 * Frontend reads it from usePage().props.navigation.
 */

/** Entity types for automatic icon resolution when no explicit icon is set. */
export type NavigationEntityType =
  | "connector"
  | "workflow"
  | "segment"
  | "instancegroup"
  | "condition"
  | "compliance"
  | "offering"
  | "order"
  | "course"
  | "category"
  | "form"
  | "certificate";

export interface NavigationNode {
  key: string;
  label: string;
  icon?: string;
  /** Entity type for automatic icon resolution (CC-based). Overrides depth fallback. */
  entityType?: NavigationEntityType;
  href?: string;
  badge?: string | number;
  /** Badge display variant: 'count' (muted text, default) or 'alert' (red pill like WooCommerce). */
  badgeVariant?: "count" | "alert";
  active?: boolean;
  /** When true, clicking replaces sidebar with this node's children + back. */
  drilldown?: boolean;
  /** When true, group renders with a toggle to expand/collapse its content. */
  collapsible?: boolean;
  /** Whether a collapsible group starts expanded (default: false). */
  defaultOpen?: boolean;
  /** CSS color for status dot shown next to drilldown title (e.g. 'var(--success)'). */
  statusColor?: string;
  /** Link target attribute (e.g. '_blank'). External URLs (http/https) auto-detect. */
  target?: string;
  children?: NavigationNode[];
}

/** Navigation payload using the unified tree model */
export interface NavigationTreePayload {
  tree: NavigationNode[];
  activeKey: string;
  /** Stack of drilled-down node keys (for ← back navigation). */
  drilldownStack?: string[];
  /** Persistent footer items (Settings, Help). */
  footer: NavigationNode[];
}
