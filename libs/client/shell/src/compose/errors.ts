abstract class CompositionError extends Error {
  public readonly featureIds: readonly string[];

  protected constructor(name: string, message: string, featureIds: readonly string[]) {
    super(message);
    this.name = name;
    this.featureIds = featureIds;
  }
}

export class RouteCompositionError extends CompositionError {
  public readonly path: string;

  constructor(path: string, message: string, featureIds: readonly string[]) {
    super('RouteCompositionError', message, featureIds);
    this.path = path;
  }
}

export class LayoutCompositionError extends CompositionError {
  public readonly id: string;

  constructor(id: string, message: string, featureIds: readonly string[]) {
    super('LayoutCompositionError', message, featureIds);
    this.id = id;
  }
}

export class ProviderCompositionError extends CompositionError {
  public readonly id: string;

  constructor(id: string, message: string, featureIds: readonly string[]) {
    super('ProviderCompositionError', message, featureIds);
    this.id = id;
  }
}

export class NavCompositionError extends CompositionError {
  public readonly id: string;

  constructor(id: string, message: string, featureIds: readonly string[]) {
    super('NavCompositionError', message, featureIds);
    this.id = id;
  }
}

export class SettingsCompositionError extends CompositionError {
  public readonly id: string;

  constructor(id: string, message: string, featureIds: readonly string[]) {
    super('SettingsCompositionError', message, featureIds);
    this.id = id;
  }
}

export class ConfigCompositionError extends CompositionError {
  public readonly key: string;

  constructor(key: string, message: string, featureIds: readonly string[]) {
    super('ConfigCompositionError', message, featureIds);
    this.key = key;
  }
}
