// Bundler-resolution ambient declarations.
// `moduleResolution: "bundler"` (required since TypeScript 7 removed node10)
// checks side-effect imports; CSS handled by webpack loaders has no module
// shape, so declare it.
declare module '*.css';
