---
"@shipfox/react-ui": patch
---

Give radio choice tiles a selected indicator dot and keep their focus ring reachable when checked. Selection is carried by the border and the dot instead of the focus `box-shadow`, so tabbing onto the already-checked item still shows a ring. The tile fill returns to opaque surface tokens so it no longer changes shade with whatever renders behind it, and `RadioGroupItemSkeleton` ships the matching placeholder so callers stop rebuilding the box by hand.
