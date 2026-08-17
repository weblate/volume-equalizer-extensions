export const resolveTabEnabled = (
  requestedEnabled: boolean,
  isToolkitCaptured: boolean,
): boolean => {
  return requestedEnabled && !isToolkitCaptured;
};

export const resolveShortcutToggle = ({
  key,
  currentValue,
  enabledKey,
  enableTab,
  isToolkitCaptured,
}: {
  key: string;
  currentValue: unknown;
  enabledKey: string;
  enableTab: boolean;
  isToolkitCaptured: boolean;
}): Record<string, boolean> | null => {
  if (isToolkitCaptured && key === enabledKey) return null;

  const values = { [key]: !currentValue };
  if (enableTab && !isToolkitCaptured) {
    values[enabledKey] = true;
  }
  return values;
};
