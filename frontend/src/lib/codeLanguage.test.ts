import { describe, it, expect } from 'vitest';
import { describeLanguage, languageLabel } from './codeLanguage';

/**
 * The upload categorizer files roughly fifty extensions as `code`
 * (backend/core/security/upload.py `_CODE`). CodeMirror's language data does
 * not cover all of them, and the gap is invisible until someone opens a file
 * and finds it grey. These tests pin which extensions are coloured, so losing
 * one is a failing build rather than a discovery.
 */

// Every extension the backend files as `code`, verbatim from `_CODE`.
const BACKEND_CODE_EXTENSIONS = [
  '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.h', '.cpp',
  '.hpp', '.cc', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt',
  '.kts', '.scala', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.sql',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.json', '.yaml',
  '.yml', '.toml', '.ini', '.xml', '.md', '.markdown', '.ipynb',
  '.lua', '.r', '.dart', '.vue', '.svelte', '.graphql', '.proto',
  '.dockerfile', '.makefile', '.gradle', '.tf', '.vim', '.el',
];

describe('languageLabel(): what the code viewer says a file is', () => {
  it('names the languages a source upload is most likely to be', () => {
    const expected: Record<string, string> = {
      'main.py': 'Python',
      'app.ts': 'TypeScript',
      'App.tsx': 'TSX',
      'index.js': 'JavaScript',
      'Card.jsx': 'JSX',
      'lib.rs': 'Rust',
      'main.go': 'Go',
      'Main.java': 'Java',
      'styles.css': 'CSS',
      'page.html': 'HTML',
      'data.json': 'JSON',
      'compose.yaml': 'YAML',
      'query.sql': 'SQL',
      'script.sh': 'Shell',
      'notes.md': 'Markdown',
      'App.vue': 'Vue',
      'index.php': 'PHP',
      'main.cpp': 'C++',
    };
    for (const [file, lang] of Object.entries(expected)) {
      expect(languageLabel(file), file).toBe(lang);
    }
  });

  it('resolves the aliases CodeMirror does not place on its own', () => {
    // Each of these is filed as `code` by the backend but has no direct entry
    // in @codemirror/language-data, so the ALIASES table carries it.
    expect(languageLabel('server.mjs')).toBe('JavaScript');
    expect(languageLabel('config.cjs')).toBe('JavaScript');
    expect(languageLabel('deploy.zsh')).toBe('Shell');
    expect(languageLabel('build.ps1')).toBe('PowerShell');
    expect(languageLabel('Model.kts')).toBe('Kotlin');
    expect(languageLabel('vec.hpp')).toBe('C++');
    expect(languageLabel('main.cc')).toBe('C++');
  });

  it('is case insensitive, because an upload keeps whatever case it had', () => {
    expect(languageLabel('MAIN.PY')).toBe(languageLabel('main.py'));
    expect(languageLabel('Setup.SQL')).toBe(languageLabel('setup.sql'));
  });

  it('never returns an empty label', () => {
    for (const ext of BACKEND_CODE_EXTENSIONS) {
      const label = languageLabel(`file${ext}`);
      expect(label, ext).toBeTruthy();
      expect(label.length, ext).toBeGreaterThan(0);
    }
  });

  it('falls back to plain text rather than guessing', () => {
    expect(languageLabel('mystery.qqq')).toBe('Plain text');
    expect(languageLabel('LICENSE')).toBe('Plain text');
    expect(languageLabel('')).toBe('Plain text');
  });

  it('covers most of what the backend calls code', () => {
    // Not all fifty resolve, and that is fine: an unmatched file still opens,
    // with line numbers and search, just uncoloured. This pins the ratio so a
    // dependency bump that quietly drops grammars is caught.
    const matched = BACKEND_CODE_EXTENSIONS.filter(
      (ext) => describeLanguage(`file${ext}`) !== null,
    );
    expect(matched.length / BACKEND_CODE_EXTENSIONS.length).toBeGreaterThan(0.75);
  });
});

describe('describeLanguage(): the grammar handed to the editor', () => {
  it('returns something loadable for a known file', async () => {
    const desc = describeLanguage('main.py');
    expect(desc).not.toBeNull();
    expect(typeof desc!.load).toBe('function');
  });

  it('returns null for a file with no grammar, so the caller can skip loading', () => {
    expect(describeLanguage('archive.zip')).toBeNull();
  });
});
