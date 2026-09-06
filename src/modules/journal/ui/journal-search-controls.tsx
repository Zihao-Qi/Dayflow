"use client";

import { Search } from "lucide-react";
import {
  JOURNAL_SEARCH_MAX_LENGTH,
  NOTE_TAG_MAX_LENGTH
} from "@/lib/journal-domain";

export function JournalSearchControls({
  kind,
  text,
  tag = "",
  loading,
  onTextChange,
  onTagChange,
  onClear
}: {
  kind: "note" | "material";
  text: string;
  tag?: string;
  loading: boolean;
  onTextChange: (value: string) => void;
  onTagChange?: (value: string) => void;
  onClear: () => void;
}) {
  const notes = kind === "note";
  const active = Boolean(text.trim() || (notes && tag.trim()));
  return (
    <div
      className="journal-search-controls"
      role="search"
      aria-label={notes ? "Search Notes" : "Search References"}
      aria-busy={loading}
    >
      <label>
        <span>{notes ? "Search Notes" : "Search References"}</span>
        <span className="journal-search-input">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={text}
            maxLength={JOURNAL_SEARCH_MAX_LENGTH}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={
              notes
                ? "Find text in complete Note history"
                : "Find reference names, links, or notes"
            }
          />
        </span>
      </label>
      {notes && onTagChange && (
        <label>
          <span>Filter by tag</span>
          <input
            value={tag}
            maxLength={NOTE_TAG_MAX_LENGTH}
            onChange={(event) => onTagChange(event.target.value)}
            placeholder="For example, decisions"
          />
        </label>
      )}
      {active && (
        <button className="text-button" type="button" onClick={onClear}>
          {notes ? "Clear filters" : "Clear search"}
        </button>
      )}
    </div>
  );
}
