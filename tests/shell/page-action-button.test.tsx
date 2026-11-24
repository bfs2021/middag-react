/**
 * PageActionButton — a disabled navigation action must render as a locked
 * <button> with no href, so it is neither navigable nor styled as enabled; and
 * the icon an action declares is drawn when the registry knows the name.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../setup";

import { PageActionButton } from "@/base/shell/partials/PageActionButton";
import { registerDefaultIcons } from "@/base/utils/register-default-icons";
import type { PageAction } from "@/contracts/page-contract";
import { I18nProvider } from "@/i18n/I18nProvider";

import { mockRouter } from "../setup";

function renderAction(extra: Partial<PageAction>) {
  const action = {
    id: "new-store",
    label: "New Store",
    intent: "primary",
    href: "/stores/create",
    ...extra,
  } as PageAction;
  return render(
    <I18nProvider>
      <PageActionButton action={action} />
    </I18nProvider>,
  );
}

describe("PageActionButton navigation", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an anchor with href when enabled", () => {
    renderAction({});
    const el = screen.getByTestId("action-new-store");
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/stores/create");
  });

  it("renders a locked button without href when disabled", () => {
    renderAction({ disabled: true });
    const el = screen.getByTestId("action-new-store");
    expect(el.tagName).toBe("BUTTON");
    expect(el.hasAttribute("href")).toBe(false);
    expect(el.querySelector("a")).toBeNull();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("data-locked")).toBe("true");
    expect((el as HTMLButtonElement).disabled).toBe(true);
    expect(el.className).toContain("disabled:opacity-50");
  });

  it("does not navigate when a disabled action is clicked", () => {
    renderAction({ disabled: true });
    fireEvent.click(screen.getByTestId("action-new-store"));
    expect(mockRouter.visit).not.toHaveBeenCalled();
  });
});

describe("PageActionButton icon", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws the action's icon when the registry knows the name", () => {
    registerDefaultIcons();
    const { container } = renderAction({ icon: "trash" });

    expect(screen.getByText("New Store")).toBeDefined();
    expect(container.querySelectorAll("svg").length).toBe(1);
  });

  it("draws nothing for an unregistered icon name", () => {
    const { container } = renderAction({ icon: "no-such-icon-name" });

    // getIcon answers an unknown name with a generic inbox glyph. Drawing the
    // wrong picture confidently is worse than drawing none, so the lookup is
    // gated on the name being registered.
    expect(container.querySelectorAll("svg").length).toBe(0);
  });

  it("renders label-only when the action declares no icon", () => {
    const { container } = renderAction({});

    expect(container.querySelectorAll("svg").length).toBe(0);
  });

  it("draws the icon on a disabled action's locked button", () => {
    registerDefaultIcons();
    const { container } = renderAction({ icon: "trash", disabled: true });

    expect(screen.getByTestId("action-new-store").tagName).toBe("BUTTON");
    expect(container.querySelectorAll("svg").length).toBe(1);
  });
});

describe("PageActionButton intent", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an unknown intent as destructive, not neutral", () => {
    renderAction({ intent: "nuke" as PageAction["intent"], disabled: true });
    const known = renderAction({ intent: "secondary" as PageAction["intent"], disabled: true });
    const secondaryClass = screen.getAllByTestId("action-new-store")[1]?.className;
    known.unmount();
    const unknownClass = screen.getByTestId("action-new-store").className;
    expect(unknownClass).not.toBe(secondaryClass);
    expect(unknownClass).toContain("destructive");
  });

  it("keeps a known non-danger intent non-destructive", () => {
    renderAction({ intent: "info" as PageAction["intent"], disabled: true });
    expect(screen.getByTestId("action-new-store").className).not.toContain("bg-destructive");
  });
});
