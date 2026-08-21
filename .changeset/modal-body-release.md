---
"@shipfox/react-ui": patch
---

Stops closing Modal, Sheet, and popper surfaces from catching clicks while they animate out. Modal and Sheet also release a body pointer-events lock left behind by a missed dismissal.
