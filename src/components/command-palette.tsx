"use client";

import {
  Check,
  Clock3,
  FolderKanban,
  LinkIcon,
  NotebookPen,
  Plus,
  Timer
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import type {
  PaletteItem,
  PaletteResolution
} from "@/lib/command-palette";

type CommandPaletteProps = {
  resolution: PaletteResolution;
  query: string;
  onQueryChange: (value: string) => void;
  onActivate: (item: PaletteItem) => void;
  onDismiss: () => void;
};

const NO_ITEMS: readonly PaletteItem[] = [];

function safeDomIdPart(value: string) {
  const encoded = Array.from(value, (character) =>
    character.codePointAt(0)?.toString(36)
  ).filter((part): part is string => Boolean(part));

  return encoded.length > 0 ? encoded.join("-") : "empty";
}

function PaletteItemIcon({ item }: { item: PaletteItem }) {
  switch (item.intent.kind) {
    case "show-focus":
    case "start-focus":
      return <Timer aria-hidden="true" size={16} />;
    case "draft-activity":
      return <Clock3 aria-hidden="true" size={16} />;
    case "draft-note":
      return <NotebookPen aria-hidden="true" size={16} />;
    case "draft-reference":
      return <LinkIcon aria-hidden="true" size={16} />;
    case "open-project":
      return <FolderKanban aria-hidden="true" size={16} />;
    case "focus-task":
    case "queue-task":
    case "draft-task":
      return <Check aria-hidden="true" size={16} />;
  }
}

export function CommandPalette({
  resolution,
  query,
  onQueryChange,
  onActivate,
  onDismiss
}: CommandPaletteProps) {
  const generatedId = useId();
  const idBase = `command-palette-${safeDomIdPart(generatedId)}`;
  const listboxId = `${idBase}-results`;
  const invalidMessageId = `${idBase}-invalid`;
  const items = resolution.state === "results" ? resolution.items : NO_ITEMS;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    items[0]?.id ?? null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollActiveOption = useRef(false);

  useEffect(() => {
    scrollActiveOption.current = false;
    setSelectedItemId(items[0]?.id ?? null);
  }, [query]);

  useEffect(() => {
    scrollActiveOption.current = false;
    setSelectedItemId((currentItemId) => {
      if (currentItemId && items.some((item) => item.id === currentItemId)) {
        return currentItemId;
      }

      return items[0]?.id ?? null;
    });
  }, [items]);

  const selectedItem = items.find((item) => item.id === selectedItemId);
  const activeOptionId = selectedItem
    ? `${idBase}-option-${safeDomIdPart(selectedItem.id)}`
    : undefined;

  useEffect(() => {
    if (!scrollActiveOption.current || !activeOptionId) {
      return;
    }

    scrollActiveOption.current = false;
    document
      .getElementById(activeOptionId)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  function moveSelection(direction: "next" | "previous") {
    scrollActiveOption.current = true;
    setSelectedItemId((currentItemId) => {
      const currentIndex = items.findIndex(
        (item) => item.id === currentItemId
      );

      if (direction === "next") {
        const nextIndex =
          currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        return items[nextIndex]?.id ?? null;
      }

      const previousIndex =
        currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      return items[previousIndex]?.id ?? null;
    });
  }

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onDismiss();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }

    if (event.nativeEvent.isComposing || items.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection("next");
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection("previous");
      return;
    }

    if (event.key === "Enter" && selectedItem) {
      event.preventDefault();
      onActivate(selectedItem);
    }
  }

  return (
    <div className="palette-overlay" onClick={handleOverlayClick}>
      <section
        aria-label="Search or add"
        aria-modal="true"
        className="command-palette"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className="palette-input">
          <Plus aria-hidden="true" size={17} />
          <input
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-describedby={
              resolution.state === "invalid" ? invalidMessageId : undefined
            }
            aria-errormessage={
              resolution.state === "invalid" ? invalidMessageId : undefined
            }
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-invalid={resolution.state === "invalid"}
            aria-label="Search commands and tasks"
            autoFocus
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Type anything — a task, a note, a URL, “focus 50”"
            ref={inputRef}
            role="combobox"
            value={query}
          />
          <kbd aria-hidden="true">esc</kbd>
        </div>

        {resolution.state === "invalid" && (
          <div
            className="palette-invalid"
            id={invalidMessageId}
            role="alert"
          >
            {resolution.message}
          </div>
        )}

        <div
          aria-label="Commands and matches"
          className="palette-results"
          id={listboxId}
          role="listbox"
        >
          {items.map((item) => {
            const optionId = `${idBase}-option-${safeDomIdPart(item.id)}`;
            const selected = item.id === selectedItemId;

            return (
              <button
                aria-selected={selected}
                className={selected ? "highlighted" : undefined}
                id={optionId}
                key={item.id}
                onClick={() => onActivate(item)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  scrollActiveOption.current = false;
                  setSelectedItemId(item.id);
                }}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <PaletteItemIcon item={item} />
                <span>{item.label}</span>
                {item.detail && (
                  <small className="palette-detail">{item.detail}</small>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
