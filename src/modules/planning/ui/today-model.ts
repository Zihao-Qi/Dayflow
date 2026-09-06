export function describeTaskMove(title: string, position: number, total: number) {
  const edge =
    position === 0 ? " Now first." : position === total - 1 ? " Now last." : "";
  return `Moved "${title}" to position ${position + 1} of ${total}.${edge}`;
}

function numberWord(value: number) {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
  return words[value] ?? String(value);
}

/**
 * A day with nothing on it has not been finished — it was never planned.
 * Saying "none left" in both cases claims a completion that did not happen.
 */
export function todayHeadline(openCount: number, doneCount: number) {
  if (openCount === 0) {
    return doneCount === 0 ? "Nothing scheduled yet" : "All done for today";
  }
  return `${numberWord(openCount)} ${openCount === 1 ? "task" : "tasks"} left`;
}
