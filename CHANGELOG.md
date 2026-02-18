# Changelog

## 0.4.0

- Fix local image rendering (SVG, PNG, etc.) in webview preview
- Expand `localResourceRoots` to include filesystem root, matching VS Code built-in preview behavior
- Resolve images in raw HTML `<img>` tags that bypass the markdown-it image renderer
- Handle `file:` URIs and absolute file paths in image resolution
- Automatically recreate preview panel when switching to documents in uncovered directories

## 0.3.0

- Add export to HTML and PDF

## 0.2.0

- Add right-click context menu for markdown preview

## 0.1.0

- Initial release
