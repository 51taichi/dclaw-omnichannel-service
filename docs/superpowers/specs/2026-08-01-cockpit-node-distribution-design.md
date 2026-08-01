# Cockpit Node Distribution Design

## Goal

Show where period-active customers actually sit in the configured task instead of classifying customers without a same-period node transition as `其他（未进入任务）`.

## Population And State

- The population remains customers with a friend, inbound-message, or outbound-message event inside the selected period.
- For each active customer, select the latest known `node_reached` event strictly before the period end.
- A node event may come from before the period start; unchanged customer state still counts.
- When several node events exist, the latest timestamp and then highest event ID wins.

## Display Rules

- Include only customers whose latest node matches a configured task node.
- Do not render an `其他` or `未进入任务` row.
- Calculate percentages using only customers matched to configured nodes, so visible rows total 100%.
- Keep configured task-node order and configured node names.
- If no active customer has a recognized node, render the existing empty state instead of an anomaly row.

## Scope

This changes cockpit aggregation only. It does not move customers between task nodes, modify task configuration, or alter message processing.

## Verification

- A customer active today but last assigned yesterday is counted in yesterday's node.
- A later node before the period end overrides an earlier node.
- Unknown and missing nodes are omitted from rows and from the percentage denominator.
- Visible shares sum to 100% when at least one recognized node exists.
- Run the complete test suite.
