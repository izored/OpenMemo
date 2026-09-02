import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';

/**
 * Which language grammar a code memo's filename should be read with.
 *
 * Split out of CodeViewer so the mapping can be tested without mounting an
 * editor. It is worth testing: the upload categorizer treats about fifty
 * extensions as `code` (backend/core/security/upload.py), CodeMirror's language
 * data does not cover all fifty, and the difference is invisible until someone
 * opens a file and finds it grey. A test that names the covered set turns that
 * into something we know rather than something we discover.
 */

/** A `.ext`-keyed override for filenames CodeMirror's own table does not place.
 *
 *  Only extensions the upload categorizer actually files as `code` are listed,
 *  and only where a real grammar exists to point at. The value is the grammar's
 *  name in `@codemirror/language-data`, so the loader stays a single path. */
const ALIASES: Record<string, string> = {
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JSX',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.zsh': 'Shell',
  '.bash': 'Shell',
  '.ps1': 'PowerShell',
  '.bat': 'Shell',
  '.kts': 'Kotlin',
  '.hpp': 'C++',
  '.cc': 'C++',
  '.h': 'C++',
  '.tf': 'HCL',
  '.el': 'Common Lisp',
  '.vim': 'Shell',
};

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i).toLowerCase();
}

/**
 * The grammar for `filename`, or null when nothing sensible matches.
 *
 * Returns the description rather than a loaded extension so the caller decides
 * when to pay for the dynamic import.
 */
export function describeLanguage(filename: string): LanguageDescription | null {
  const direct = LanguageDescription.matchFilename(languages, filename);
  if (direct) return direct;

  // CodeMirror matches the extension case-sensitively, and an upload keeps
  // whatever case it arrived with. REPORT.SQL and Main.PY are ordinary files
  // off a Windows machine, and without this they render grey.
  const lowered = filename.toLowerCase();
  if (lowered !== filename) {
    const insensitive = LanguageDescription.matchFilename(languages, lowered);
    if (insensitive) return insensitive;
  }

  const alias = ALIASES[extensionOf(filename)];
  if (!alias) return null;
  return languages.find((l) => l.name === alias) ?? null;
}

/** The label the toolbar shows. Never empty: an unknown file is plain text. */
export function languageLabel(filename: string): string {
  return describeLanguage(filename)?.name ?? 'Plain text';
}

/**
 * Load the grammar for `filename`.
 *
 * A grammar that fails to load costs the file its colour and nothing else, so
 * the failure comes back as a null extension beside the label we already knew.
 */
export async function loadLanguage(
  filename: string,
): Promise<{ ext: Extension | null; label: string }> {
  const desc = describeLanguage(filename);
  if (!desc) return { ext: null, label: 'Plain text' };
  try {
    return { ext: await desc.load(), label: desc.name };
  } catch {
    return { ext: null, label: desc.name };
  }
}
