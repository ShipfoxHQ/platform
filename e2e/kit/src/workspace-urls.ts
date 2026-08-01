export const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;

export function workspaceUrlRe(workspaceSlug: string): RegExp {
  return new RegExp(`/w/${workspaceSlug}(/|$)`, 'u');
}
