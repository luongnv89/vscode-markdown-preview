# User Guide

A comprehensive guide to all features in Markdown Preview Pro.

## Getting Started

Open any `.md` file and press `Cmd+Shift+V` (macOS) or `Ctrl+Shift+V` (Windows/Linux) to open the preview side by side.

You can also:

- Use the Command Palette: **Markdown Preview Pro: Open Preview to Side**
- Click the preview icon in the editor title bar

## Syntax Highlighting

Code blocks are highlighted automatically using highlight.js with the GitHub Dark theme.

Specify a language for best results:

````markdown
```python
def hello():
    print("Hello, world!")
```
````

Auto-detection works for unlabeled code blocks, but explicitly specifying the language is faster and more accurate.

**Supported languages:** All languages supported by [highlight.js](https://highlightjs.org/download) including Python, JavaScript, TypeScript, Go, Rust, C/C++, Java, SQL, Bash, and 180+ more.

### Copy Button

Every code block has a **Copy** button in the top-right corner. Click it to copy the code to your clipboard.

## Mermaid Diagrams

Use fenced code blocks with the `mermaid` language to render diagrams.

### Flowchart

````markdown
```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
```
````

### Sequence Diagram

````markdown
```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Database

    Client->>Server: HTTP Request
    Server->>Database: Query
    Database-->>Server: Results
    Server-->>Client: Response
```
````

### Class Diagram

````markdown
```mermaid
classDiagram
    class Animal {
        +String name
        +makeSound()
    }
    class Dog {
        +fetch()
    }
    class Cat {
        +purr()
    }
    Animal <|-- Dog
    Animal <|-- Cat
```
````

### State Diagram

````markdown
```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Submit
    Processing --> Success: Valid
    Processing --> Error: Invalid
    Error --> Idle: Retry
    Success --> [*]
```
````

### Pie Chart

````markdown
```mermaid
pie title Project Time Allocation
    "Development" : 45
    "Testing" : 25
    "Documentation" : 15
    "Planning" : 15
```
````

### Gantt Chart

````markdown
```mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Design     :a1, 2026-01-01, 30d
    Prototype  :a2, after a1, 20d
    section Phase 2
    Development :b1, after a2, 45d
    Testing     :b2, after b1, 15d
```
````

For the full syntax reference, see the [Mermaid documentation](https://mermaid.js.org/intro/).

**Theme:** Diagrams automatically adapt to your VS Code theme (dark or light).

## KaTeX Math

### Inline Math

Wrap expressions in single dollar signs:

```markdown
The formula $E = mc^2$ shows mass-energy equivalence.
```

### Block Math

Wrap expressions in double dollar signs, each on their own line:

```markdown
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

### Common Examples

| Syntax                                           | Result        |
| ------------------------------------------------ | ------------- |
| `$x^2$`                                          | Superscript   |
| `$x_i$`                                          | Subscript     |
| `$\frac{a}{b}$`                                  | Fraction      |
| `$\sqrt{x}$`                                     | Square root   |
| `$\sum_{i=1}^{n} i$`                             | Summation     |
| `$\alpha, \beta, \gamma$`                        | Greek letters |
| `$\mathbf{v}$`                                   | Bold vector   |
| `$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$` | Matrix        |

For the full function list, see [KaTeX Supported Functions](https://katex.org/docs/supported).

## Task Lists

Create interactive checklists using standard markdown syntax:

```markdown
- [x] Completed task
- [ ] Pending task
- [ ] Another pending task
```

**Click a checkbox** in the preview to toggle it. The change is written back to the source file automatically.

Supported list markers: `-`, `*`, `+`

## Scroll Sync

When enabled, scrolling in either the editor or the preview will sync the other:

- **Editor → Preview:** Scroll the editor and the preview follows
- **Preview → Editor:** Scroll the preview and the editor follows

A 300ms lock prevents feedback loops. Disable via `markdownPreviewPro.scrollSync: false`.

## Images

### Relative Paths

Use paths relative to the markdown file:

```markdown
![Screenshot](./images/screenshot.png)
![Diagram](../diagrams/flow.svg)
```

### Remote Images

```markdown
![Logo](https://example.com/logo.png)
```

### Excalidraw

Reference exported Excalidraw files:

```markdown
![Architecture](./diagrams/architecture.excalidraw.png)
![Design](./diagrams/design.excalidraw.svg)
```

## Smart Typography

When `typographer` is enabled (default), markdown-it applies:

| Input      | Output         |
| ---------- | -------------- |
| `"quotes"` | "smart quotes" |
| `'single'` | 'smart single' |
| `--`       | en-dash        |
| `---`      | em-dash        |
| `...`      | ellipsis       |

Disable via `markdownPreviewPro.typographer: false`.

## Configuration Reference

Open VS Code Settings and search for `markdownPreviewPro`:

### `scrollSync` (default: `true`)

Enable bidirectional scroll synchronization between editor and preview.

### `enableMermaid` (default: `true`)

Enable Mermaid diagram rendering. Disable for faster rendering on large files without diagrams.

### `enableKatex` (default: `true`)

Enable KaTeX math rendering. Inline `$...$` and block `$$...$$` syntax.

### `enableCheckboxes` (default: `true`)

Enable interactive task list checkboxes. When enabled, clicking a checkbox in the preview updates the source file.

### `typographer` (default: `true`)

Enable smart quotes and typographic replacements (em-dash, en-dash, ellipsis).

### `lineBreaks` (default: `false`)

Convert single newlines in paragraphs to `<br>` tags. By default, adjacent lines are joined into a single paragraph (standard markdown behavior).

## Export

### Export to HTML

Generate a standalone HTML file with all styles, fonts, and scripts embedded. Mermaid diagrams are rendered to SVG and KaTeX math is fully resolved.

**How to export:**

1. Open a `.md` file
2. Use one of these methods:
   - Open the Command Palette and run **Markdown Preview Pro: Export to HTML**
   - Right-click in the editor and select **Export to HTML**
   - Right-click a `.md` file in the Explorer and select **Export to HTML**
   - Click the HTML icon in the editor title bar

The output file is saved alongside the source markdown file with the `.html` extension.

### Export to PDF

Generate a PDF file using a locally installed Chrome or Chromium browser.

**How to export:**

1. Open a `.md` file
2. Use one of these methods:
   - Open the Command Palette and run **Markdown Preview Pro: Export to PDF**
   - Right-click in the editor and select **Export to PDF**
   - Right-click a `.md` file in the Explorer and select **Export to PDF**
   - Click the PDF icon in the editor title bar

The output file is saved alongside the source markdown file with the `.pdf` extension.

**Requirements:** A Chrome or Chromium browser must be installed on your system. The extension automatically detects the browser on macOS, Windows, and Linux.

## Keyboard Shortcuts

| Action               | macOS         | Windows/Linux  |
| -------------------- | ------------- | -------------- |
| Open Preview to Side | `Cmd+Shift+V` | `Ctrl+Shift+V` |
| Open Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |

## Tips

- **Navigate to source:** Double-click any element in the preview to jump to its line in the editor
- **Code blocks:** Specify the language for faster, more accurate syntax highlighting
- **Large files:** Disable Mermaid if you don't use diagrams to speed up rendering
- **Theme switching:** Mermaid diagrams automatically re-render when you change your VS Code theme

## Related Docs

- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and fixes
- [Configuration](../README.md#configuration) - Quick settings reference
