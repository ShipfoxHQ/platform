export const GENERATED_MANIFEST_FILE = 'content/generated/generated-artifacts.json';

export interface GeneratedArtifactDescriptor {
  format: 'markdown' | 'json';
  file?: string;
}

export type GeneratedArtifactManifest = Readonly<Record<string, GeneratedArtifactDescriptor>>;
