---
'@shipfox/application-release': minor
---

Adds renderFixtureWorkspaceConfig so packed-consumer fixtures carry the repository's minimum release age policy instead of resolving day-old third-party releases. The yaml parser becomes a runtime dependency because the published closure helper reads the repository workspace file.
