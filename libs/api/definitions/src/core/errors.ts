export class DefinitionParseError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'DefinitionParseError';
  }
}
