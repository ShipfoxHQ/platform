---
"@shipfox/react-ui": major
---

Remove the `Card` component and migrate its consumers to `Panel`.

Migration mapping: `Card` to `Panel`, `CardHeader` to `PanelHeader variant="plain"`,
`CardTitle` to `PanelTitle`, `CardContent` to `PanelBody`, `CardAction` to
`PanelActions`, and `CardDescription` to a muted `Text` component. Keep
`CardFooter` content in the panel layout or a `PanelBody`.
