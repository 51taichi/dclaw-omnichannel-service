# Cockpit Four-Digit Metrics Design

## Goal

Keep cockpit message metrics readable without allowing large values to distort the fixed metric-card layout.

## Display Rules

- Values from `0` through `9999` display as complete integers.
- Values from `10000` use the existing Chinese compact units, such as `1.2万` and `12万`.
- Every metric value keeps its full comma-separated integer in the native hover tooltip.
- The metric value slot grows from `58px` to `76px`.
- The metric font becomes slightly smaller while retaining tabular numerals and right alignment.
- Metric cards keep their current dimensions and labels.

## Scope

This is a console-only formatting and layout change. It does not alter cockpit aggregation, persisted snapshots, API contracts, or metric definitions.

## Verification

- Add a boundary test proving `9999` remains unabridged and the `千` formatter is removed.
- Verify values at and above `10000` still use `万`/`亿` compaction.
- Verify the full number remains available through the `title` attribute.
- Run the complete test suite.
