/**
 * Shared props — the Inertia props every host sends on each request.
 *
 * The wire shape is generated from the middag-php-ui 'SharedProps' value object
 * (schema/shared-props.json). Read them with usePage<SharedProps>().props.
 */

export type { FlashMessages, SharedAuth, SharedProps, SharedTheme } from "@/contracts/generated";

/** One tab of the host admin tab bar. */
export interface AdminTabItem {
  key: string;
  label: string;
  href: string;
}

/**
 * The 'admin_tabs' prop some hosts add next to the shared props. It is wire with
 * no php-ui value object: each host builds it, and the shared props carry it
 * through their open index signature.
 */
export interface AdminTabsProps {
  active: string;
  items: AdminTabItem[];
}
