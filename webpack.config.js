//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  plugins: [
    // Force everything into a single chunk - VS Code extensions must be a single file
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
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
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.json',
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
const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './webview/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'webview'),
    filename: 'main.js',
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
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.webview.json',
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

module.exports = [extensionConfig, webviewConfig];
