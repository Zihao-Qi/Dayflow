"use client";

import { SegmentedControl } from "@/components/workspace-ui";
import type { BacklogArrange } from "@/modules/planning/ui/backlog-model";

export function ArrangementControl({
  value,
  options,
  onChange
}: {
  value: BacklogArrange;
  options: Array<[BacklogArrange, string]>;
  onChange: (value: BacklogArrange) => void;
}) {
  return (
    <div className="arrange-control">
      <span>Arrange</span>
      <SegmentedControl
        ariaLabel="Arrange backlog by"
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

