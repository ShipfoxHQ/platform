import {argosScreenshot, type Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type ElementHandle = NonNullable<Awaited<ReturnType<Locator['elementHandle']>>>;

interface MutableElement {
  textContent: string | null;
  value?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface StableReplacement {
  locator: Locator;
  text?: string;
  attributes?: Record<string, string>;
  value?: string;
}

export interface StableScreenshotOptions {
  replacements?: StableReplacement[];
  textReplacements?: ReadonlyArray<readonly [string, string]>;
  hideToaster?: boolean;
}

interface ElementSnapshot {
  handle: ElementHandle;
  text?: string | null;
  value?: string;
  attributes: Record<string, string | null>;
}

interface LocatorSnapshot {
  elements: ElementSnapshot[];
}

export async function stableScreenshot(
  page: Page,
  name: string,
  replacementsOrOptions: StableReplacement[] | StableScreenshotOptions = [],
): Promise<void> {
  const options = Array.isArray(replacementsOrOptions)
    ? {replacements: replacementsOrOptions}
    : replacementsOrOptions;
  const snapshots: LocatorSnapshot[] = [];
  let pageWideReplacementsApplied = false;
  let operationError: unknown;

  try {
    if (options.textReplacements || options.hideToaster) {
      await applyPageWideReplacements(page, {
        textReplacements: options.textReplacements ?? [],
        hideToaster: options.hideToaster ?? false,
      });
      pageWideReplacementsApplied = true;
    }
    await applyReplacements(options.replacements ?? [], snapshots);
    await argosScreenshot(page, name);
  } catch (error) {
    operationError = error;
  }

  let restoreError: unknown;
  try {
    if (snapshots.length > 0) await restoreSnapshots(snapshots);
  } catch (error) {
    restoreError = error;
  }
  if (pageWideReplacementsApplied) await restorePageWideReplacements(page);
  if (restoreError) throw restoreError;
  if (operationError) throw operationError;
}

async function applyPageWideReplacements(
  page: Page,
  options: {
    textReplacements: ReadonlyArray<readonly [string, string]>;
    hideToaster: boolean;
  },
): Promise<void> {
  await page.evaluate((input) => {
    type RestoreEntry =
      | {kind: 'attribute'; target: Element; attribute: string; value: string}
      | {kind: 'text'; target: Text; value: string}
      | {kind: 'value'; target: HTMLInputElement | HTMLTextAreaElement; value: string};
    const visualWindow = window as Window & {
      __shipfoxVisualRestore?: RestoreEntry[];
      __shipfoxToasterDisplay?: string;
    };
    const restoreEntries: RestoreEntry[] = [];

    if (input.hideToaster) {
      const toaster = document.querySelector('[data-sonner-toaster]');
      if (toaster instanceof HTMLElement) {
        visualWindow.__shipfoxToasterDisplay = toaster.style.display;
        toaster.style.display = 'none';
      }
    }

    const replaceValue = (value: string): string =>
      input.textReplacements.reduce(
        (current, [source, replacement]) => current.split(source).join(replacement),
        value,
      );

    function replaceTextNodes(): void {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const textNode = node as Text;
        const nextValue = replaceValue(textNode.data);
        if (nextValue !== textNode.data) {
          restoreEntries.push({kind: 'text', target: textNode, value: textNode.data});
          textNode.data = nextValue;
        }
        node = walker.nextNode();
      }
    }

    function replaceInputValues(): void {
      for (const element of document.querySelectorAll('input, textarea')) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          continue;
        }
        const nextValue = replaceValue(element.value);
        if (nextValue !== element.value) {
          restoreEntries.push({kind: 'value', target: element, value: element.value});
          element.value = nextValue;
        }
      }
    }

    function replaceAttributes(): void {
      for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
        replaceElementAttributes(element);
      }
    }

    function replaceElementAttributes(element: Element): void {
      for (const attribute of ['aria-label', 'placeholder', 'title']) {
        const value = element.getAttribute(attribute);
        if (value == null) continue;
        const nextValue = replaceValue(value);
        if (nextValue !== value) {
          restoreEntries.push({kind: 'attribute', target: element, attribute, value});
          element.setAttribute(attribute, nextValue);
        }
      }
    }

    replaceTextNodes();
    replaceInputValues();
    replaceAttributes();
    visualWindow.__shipfoxVisualRestore = restoreEntries;
  }, options);
}

async function restorePageWideReplacements(page: Page): Promise<void> {
  await page.evaluate(() => {
    type RestoreEntry =
      | {kind: 'attribute'; target: Element; attribute: string; value: string}
      | {kind: 'text'; target: Text; value: string}
      | {kind: 'value'; target: HTMLInputElement | HTMLTextAreaElement; value: string};
    const visualWindow = window as Window & {
      __shipfoxVisualRestore?: RestoreEntry[];
      __shipfoxToasterDisplay?: string;
    };
    const restoreEntries = visualWindow.__shipfoxVisualRestore ?? [];

    function restoreEntry(entry: RestoreEntry): void {
      if (entry.kind === 'text') {
        entry.target.data = entry.value;
        return;
      }
      if (entry.kind === 'value') {
        entry.target.value = entry.value;
        return;
      }
      entry.target.setAttribute(entry.attribute, entry.value);
    }

    for (const entry of restoreEntries.reverse()) {
      restoreEntry(entry);
    }

    const toaster = document.querySelector('[data-sonner-toaster]');
    if (toaster instanceof HTMLElement && visualWindow.__shipfoxToasterDisplay !== undefined) {
      toaster.style.display = visualWindow.__shipfoxToasterDisplay;
    }

    delete visualWindow.__shipfoxToasterDisplay;
    delete visualWindow.__shipfoxVisualRestore;
  });
}

async function applyReplacements(
  replacements: StableReplacement[],
  snapshots: LocatorSnapshot[],
): Promise<void> {
  for (const replacement of replacements) {
    const count = await replacement.locator.count();
    const locatorSnapshot: LocatorSnapshot = {
      elements: [],
    };
    snapshots.push(locatorSnapshot);

    for (let index = 0; index < count; index += 1) {
      const locator = replacement.locator.nth(index);
      const handle = await locator.elementHandle();
      if (!handle) {
        throw new Error(
          'Cannot apply stable screenshot replacements: locator element disappeared before capture.',
        );
      }

      let shouldDisposeHandle = true;
      try {
        const snapshot = await handle.evaluate(
          (
            element: MutableElement,
            options: {
              textReplacement: string | undefined;
              attributes: Record<string, string>;
              valueReplacement: string | undefined;
            },
          ): Omit<ElementSnapshot, 'handle'> => {
            function snapshotText(snapshot: Omit<ElementSnapshot, 'handle'>): void {
              if (options.textReplacement !== undefined) snapshot.text = element.textContent;
            }

            function snapshotValue(snapshot: Omit<ElementSnapshot, 'handle'>): void {
              if (options.valueReplacement === undefined || !('value' in element)) return;
              const currentValue = element.value;
              if (currentValue !== undefined) snapshot.value = currentValue;
            }

            function snapshotElement(): Omit<ElementSnapshot, 'handle'> {
              const snapshot: Omit<ElementSnapshot, 'handle'> = {
                attributes: Object.fromEntries(
                  Object.keys(options.attributes).map((name) => [name, element.getAttribute(name)]),
                ),
              };
              snapshotText(snapshot);
              snapshotValue(snapshot);
              return snapshot;
            }

            function replaceText(): void {
              if (options.textReplacement !== undefined) {
                element.textContent = options.textReplacement;
              }
            }

            function replaceValue(): void {
              if (options.valueReplacement === undefined || !('value' in element)) return;
              element.value = options.valueReplacement;
            }

            function replaceAttributes(): void {
              for (const [name, value] of Object.entries(options.attributes)) {
                element.setAttribute(name, value);
              }
            }

            const previous = snapshotElement();
            replaceText();
            replaceValue();
            replaceAttributes();
            return previous;
          },
          {
            textReplacement: replacement.text,
            attributes: replacement.attributes ?? {},
            valueReplacement: replacement.value,
          },
        );
        locatorSnapshot.elements.push({...snapshot, handle});
        shouldDisposeHandle = false;
      } finally {
        if (shouldDisposeHandle) await handle.dispose();
      }
    }
  }
}

async function restoreSnapshots(snapshots: LocatorSnapshot[]): Promise<void> {
  let restoreError: unknown;

  for (const snapshot of [...snapshots].reverse()) {
    for (const elementSnapshot of [...snapshot.elements].reverse()) {
      try {
        const previous: Omit<ElementSnapshot, 'handle'> = {
          attributes: elementSnapshot.attributes,
        };
        if (elementSnapshot.text !== undefined) previous.text = elementSnapshot.text;
        if (elementSnapshot.value !== undefined) previous.value = elementSnapshot.value;
        await elementSnapshot.handle.evaluate(
          (element: MutableElement, previous: Omit<ElementSnapshot, 'handle'>) => {
            function restoreAttributes(): void {
              for (const [name, value] of Object.entries(previous.attributes)) {
                if (value === null) element.removeAttribute(name);
                else element.setAttribute(name, value);
              }
            }

            if (previous.text !== undefined) element.textContent = previous.text;
            if (previous.value !== undefined && 'value' in element) element.value = previous.value;
            restoreAttributes();
          },
          previous,
        );
      } catch (error) {
        restoreError ??= error;
      } finally {
        await elementSnapshot.handle.dispose();
      }
    }
  }

  if (restoreError) throw restoreError;
}
