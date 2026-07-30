/** Open the drawer from a screen that is a direct child of the Drawer navigator */
export function openDrawer(nav: { openDrawer?: () => void } | Record<string, unknown>) {
  (nav as { openDrawer?: () => void }).openDrawer?.();
}
