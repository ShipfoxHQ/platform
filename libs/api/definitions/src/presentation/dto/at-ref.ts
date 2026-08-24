import type {DefinitionAtRefFileDto} from '@shipfox/api-definitions-dto';
import type {DefinitionAtRefFile} from '#core/resolve-definition-at-ref.js';

export function toDefinitionAtRefFileDto(file: DefinitionAtRefFile): DefinitionAtRefFileDto {
  return {
    config_path: file.configPath,
    name: file.name,
    valid: file.valid,
    errors: file.errors,
    warnings: file.warnings,
    triggers: file.triggers,
  };
}
