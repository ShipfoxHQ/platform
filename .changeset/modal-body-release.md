---
"@shipfox/react-ui": patch
---

Stops closing Modal, Sheet, and DropdownMenu surfaces from catching clicks while they animate out, and releases the body pointer-events lock once they close, so a stalled or missed dismissal no longer leaves the page unclickable until a reload.
