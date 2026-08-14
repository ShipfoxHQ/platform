---
"@shipfox/react-ui": minor
---

Add `PanelGrid`, `PanelCell`, and `PanelCellAction` for a two-column grid of cells divided by hairlines, collapsing to one column at 760px and padding an odd cell count so the last row's divider spans the panel. `PanelCellAction` renders a trailing verb and chevron from an `action` prop. Add a `--shadow-focus-inset` token for controls whose parent clips the outset focus ring. `Panel`, `PanelBody`, and `PanelRow` accept `asChild`, so a panel can render as an `aside` and a row list can keep `ul` and `li` semantics.
