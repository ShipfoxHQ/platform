---
'@shipfox/api-integration-github': patch
---

Declares commit-status read access for pull request status reads and contents read for pull request diffs, reads issue types through the repository endpoint, and fixes the sub-issue removal route.

Applies requested reviewers when a pull request is created or updated, rejects malformed reviewer entries before saving, reports reviewer-request failures with the saved pull request number, and rejects workflow-file commits with an explicit access-denied error when the installation token lacks the workflows permission.

Reports a null review thread as an explicit error instead of success, validates review comment positions and review-write method arguments before calling GitHub, and includes GitHub's accepted-permissions header in access-denied errors.
