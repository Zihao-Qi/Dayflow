export const ACTIVITY_CATEGORY_MAX_LENGTH = 100;
export const DEFAULT_ACTIVITY_CATEGORIES = [
  "Deep Work",
  "Learning",
  "Admin",
  "Health",
  "Rest"
] as const;
export const DEFAULT_ACTIVITY_CATEGORY = DEFAULT_ACTIVITY_CATEGORIES[0];

export function buildActivityCategorySuggestions(
  persistedLabels: readonly string[]
) {
  const suggestions = [...DEFAULT_ACTIVITY_CATEGORIES] as string[];
  const seen = new Set(
    DEFAULT_ACTIVITY_CATEGORIES.map(categorySuggestionKey)
  );
  const custom = persistedLabels
    .map((label) => label.trim())
    .filter(
      (label) =>
        label.length > 0 &&
        label.length <= ACTIVITY_CATEGORY_MAX_LENGTH
    )
    .sort(
      (left, right) =>
        left.localeCompare(right, "en-US", { sensitivity: "base" }) ||
        left.localeCompare(right, "en-US")
    );

  for (const label of custom) {
    const key = categorySuggestionKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(label);
  }
  return suggestions;
}

function categorySuggestionKey(value: string) {
  return value.toLocaleLowerCase("en-US");
}
