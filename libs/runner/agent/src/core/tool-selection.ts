export function toolSelectionOption(
  configuredTools: readonly string[] | undefined,
  requiredTools: readonly string[],
): {readonly tools?: string[]} {
  if (configuredTools === undefined) return {};

  const selectedTools = [...configuredTools];
  for (const requiredTool of requiredTools) {
    if (!selectedTools.includes(requiredTool)) selectedTools.push(requiredTool);
  }
  return {tools: selectedTools};
}
