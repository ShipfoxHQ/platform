'use client';

import {useEffect, useState} from 'react';
import type {ShikiTransformer} from 'shiki';

type ShikiThemes = {
  light: string;
  dark: string;
};

type UseShikiHighlightOptions = {
  code: string;
  lang: string;
  themes: ShikiThemes;
  resolvedTheme: 'light' | 'dark';
  syntaxHighlighting: boolean;
};

function diffLineTransformer(): ShikiTransformer {
  return {
    name: '@shipfox/react-ui:diff-line-styling',
    line(node, lineNumber) {
      const line = this.source.split('\n')[lineNumber - 1] ?? '';

      if (line.startsWith('+') && !line.startsWith('+++')) {
        this.addClassToHast(node, ['diff', 'add']);
      }

      if (line.startsWith('-') && !line.startsWith('---')) {
        this.addClassToHast(node, ['diff', 'remove']);
      }

      return node;
    },
  };
}

export function useShikiHighlight({
  code,
  lang,
  themes,
  resolvedTheme,
  syntaxHighlighting,
}: UseShikiHighlightOptions): {highlightedCode: string; isLoading: boolean} {
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(syntaxHighlighting);
  const {light: lightTheme, dark: darkTheme} = themes;

  useEffect(() => {
    if (!syntaxHighlighting) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    void loadHighlightedCode(
      {code, lang, themes: {light: lightTheme, dark: darkTheme}, resolvedTheme},
      () => cancelled,
      (html) => {
        setHighlightedCode(html);
        setIsLoading(false);
      },
      () => {
        setHighlightedCode('');
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [code, lang, lightTheme, darkTheme, resolvedTheme, syntaxHighlighting]);

  return {highlightedCode, isLoading};
}

type UseShikiHighlightMultipleOptions = {
  codes: Record<string, string>;
  lang: string;
  themes: ShikiThemes;
  resolvedTheme: 'light' | 'dark';
  syntaxHighlighting: boolean;
};

export function useShikiHighlightMultiple({
  codes,
  lang,
  themes,
  resolvedTheme,
  syntaxHighlighting,
}: UseShikiHighlightMultipleOptions): {
  highlightedCodes: Record<string, string>;
  isLoading: boolean;
} {
  const [highlightedCodes, setHighlightedCodes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(syntaxHighlighting);
  const {light: lightTheme, dark: darkTheme} = themes;

  useEffect(() => {
    if (!syntaxHighlighting) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    void loadHighlightedCodes(
      {codes, lang, themes: {light: lightTheme, dark: darkTheme}, resolvedTheme},
      () => cancelled,
      (result) => {
        setHighlightedCodes(result);
        setIsLoading(false);
      },
      () => {
        setHighlightedCodes({});
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [resolvedTheme, lang, lightTheme, darkTheme, codes, syntaxHighlighting]);

  return {highlightedCodes, isLoading};
}

async function loadHighlightedCode(
  options: Pick<UseShikiHighlightOptions, 'code' | 'lang' | 'themes' | 'resolvedTheme'>,
  cancelled: () => boolean,
  onLoaded: (html: string) => void,
  onError: () => void,
): Promise<void> {
  try {
    const {codeToHtml} = await import('shiki');
    const html = await codeToHtml(options.code, {
      lang: options.lang,
      themes: options.themes,
      defaultColor: options.resolvedTheme === 'dark' ? 'dark' : 'light',
      ...(options.lang === 'diff' ? {transformers: [diffLineTransformer()]} : {}),
    });
    if (!cancelled()) onLoaded(html);
  } catch {
    if (!cancelled()) onError();
  }
}

async function loadHighlightedCodes(
  options: Pick<UseShikiHighlightMultipleOptions, 'codes' | 'lang' | 'themes' | 'resolvedTheme'>,
  cancelled: () => boolean,
  onLoaded: (html: Record<string, string>) => void,
  onError: () => void,
): Promise<void> {
  try {
    const {codeToHtml} = await import('shiki');
    const highlightedCodes: Record<string, string> = {};
    for (const [command, value] of Object.entries(options.codes)) {
      if (cancelled()) return;
      highlightedCodes[command] = await codeToHtml(value, {
        lang: options.lang,
        themes: options.themes,
        defaultColor: options.resolvedTheme === 'dark' ? 'dark' : 'light',
      });
    }
    if (!cancelled()) onLoaded(highlightedCodes);
  } catch {
    if (!cancelled()) onError();
  }
}
