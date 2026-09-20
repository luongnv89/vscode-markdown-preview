// Ambient types for `highlight.js/lib/languages/*` — the grammar modules ship
// no .d.ts, so each subpath import is declared a LanguageFn (the signature
// hljs.registerLanguage expects). Referenced from src/hljsLanguages.ts via a
// triple-slash directive so every tsconfig that compiles that file pulls this
// declaration into the program.
declare module 'highlight.js/lib/languages/*' {
  import { LanguageFn } from 'highlight.js';
  const language: LanguageFn;
  export default language;
}
