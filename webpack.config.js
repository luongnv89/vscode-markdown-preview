//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const { execSync } = require('child_process');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

// Resolved once per build, here in the Node context — the extension bundle
// itself never spawns git at runtime (issue #76): a marketplace install dir is
// not a repo, so a runtime `git rev-parse` would always fail. Builds run in a
// checkout (or CI), where the SHA names exactly the commit being packaged.
let gitCommit = '';
try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // No git / not a checkout — the About popup degrades to an empty commit.
}

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    // Wipe stale output (including lazy chunks from a previous mode's build)
    // before this config emits — the first config in the array owns cleaning.
    // The keep patterns preserve what the sibling configs emit into the same
    // directory (dist/markdownCore.js, dist/webview/), whichever order the
    // MultiCompiler runs the emits in.
    clean: { keep: /^webview\/|^markdownCore\.js/ },
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  // No LimitChunkCountPlugin: the two heavy export-only deps behind
  // `await import()` (jsdom, puppeteer-core) emit as separate lazy chunks in
  // dist/ and are require()'d on first export, instead of inflating
  // dist/extension.js — the activation-time bundle (issue #73). Synchronous
  // imports still land in the single entry chunk.
  plugins: [
    // Bakes the build-time commit SHA into src/utils/aboutInfo.ts (issue #76).
    new webpack.DefinePlugin({
      __GIT_COMMIT__: JSON.stringify(gitCommit),
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            // TypeScript 7 is a native binary without the JS compiler API
            // ts-loader requires; esbuild transpiles TS, `tsc --noEmit`
            // (CI) keeps the typecheck gate.
            loader: 'esbuild-loader',
            options: {
              loader: 'ts',
              target: 'es2020',
            },
          },
        ],
      },
    ],
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

/** @type {import('webpack').Configuration} */
// The vscode-free shared markdown pipeline, emitted as a plain CommonJS module
// so scripts/generate-landing.cjs (run by bare Node) renders through the same
// engine the extension bundles. Runtime deps stay external — the generator
// resolves them from node_modules like any other Node script.
const sharedCoreConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/markdownCore.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'markdownCore.js',
    libraryTarget: 'commonjs2',
  },
  externals: [
    {
      'markdown-it': 'commonjs markdown-it',
      yaml: 'commonjs yaml',
    },
    // highlight.js resolves from node_modules like the other runtime deps —
    // lib/core plus the grammar subset src/hljsLanguages.ts registers.
    ({ request }, callback) => {
      if (request === 'highlight.js' || request.startsWith('highlight.js/')) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'esbuild-loader',
            options: {
              loader: 'ts',
              target: 'es2020',
            },
          },
        ],
      },
    ],
  },
  devtool: 'nosources-source-map',
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: {
    main: './webview/main.ts',
    // @excalidraw/utils is ESM-only since 0.1.4 — bundle it here instead of
    // copying a prebuilt UMD file (no longer shipped upstream).
    'vendor/excalidraw-utils.min': './webview/excalidrawUtils.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'webview'),
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'esbuild-loader',
            options: {
              loader: 'ts',
              target: 'es2020',
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'main.css',
    }),
    // Copy vendor runtime files needed by the webview (loaded via script/link tags)
    new CopyPlugin({
      patterns: [
        { from: 'node_modules/katex/dist/katex.min.css', to: 'vendor/' },
        { from: 'node_modules/katex/dist/katex.min.js', to: 'vendor/' },
        { from: 'node_modules/katex/dist/fonts', to: 'vendor/fonts' },
        { from: 'node_modules/mermaid/dist/mermaid.min.js', to: 'vendor/' },
        { from: 'node_modules/highlight.js/styles/github-dark.min.css', to: 'vendor/' },
      ],
    }),
  ],
  devtool: 'nosources-source-map',
};

module.exports = [extensionConfig, sharedCoreConfig, webviewConfig];
