# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

⚠️ **CRITICAL PRIORITY:**
If the conditions for using Serena MCP are met, **ALWAYS use it**.
No exceptions.
## Quick Reference: When to Use Serena Tools

### 1. **Code Understanding / Exploration**

#### `mcp__serena__get_symbols_overview`
**Purpose:** Get a bird's-eye view of top-level symbols per directory/file. Start here to get the map.
**Arguments:**
- `relative_path` (required): Path to file or directory to analyze
- `max_answer_chars` (optional, default: 200000): Maximum response size

**Example:**
```python
# Get overview of all symbols in a file
mcp__serena__get_symbols_overview(relative_path="src/background/api.js")

# Get overview of entire directory
mcp__serena__get_symbols_overview(relative_path="src/background")
```

#### `mcp__serena__find_symbol`
**Purpose:** Search for functions/classes/variables by name (partial match). For searches with a clear target.
**Arguments:**
- `name_path` (required): Symbol name or path to search (e.g., "translateText" or "class/method")
- `relative_path` (optional): Restrict search to specific file/directory
- `include_body` (optional, default: false): Include symbol source code
- `depth` (optional, default: 0): Depth for retrieving children
- `substring_matching` (optional, default: false): Enable partial name matching

**Example:**
```python
# Find a function by name
mcp__serena__find_symbol(name_path="translateText", include_body=true)

# Find all methods in a class
mcp__serena__find_symbol(name_path="MessageHandler", depth=1, relative_path="src/background")

# Find with substring matching
mcp__serena__find_symbol(name_path="verify", substring_matching=true)
```

#### `mcp__serena__find_referencing_symbols`
**Purpose:** Reverse lookup of callers/references. For identifying the scope of impact.
**Arguments:**
- `name_path` (required): Symbol to find references for
- `relative_path` (required): File containing the symbol
- `max_answer_chars` (optional): Maximum response size

**Example:**
```python
# Find all places that call translateText function
mcp__serena__find_referencing_symbols(
    name_path="translateText",
    relative_path="src/background/api.js"
)
```

#### `mcp__serena__search_for_pattern`
**Purpose:** Flexible regex search in codebase. Use when symbol search isn't sufficient.
**Arguments:**
- `substring_pattern` (required): Regex pattern to search for
- `relative_path` (optional): Restrict to specific path
- `context_lines_before/after` (optional, default: 0): Context lines to include
- `restrict_search_to_code_files` (optional, default: false): Only search code files

**Example:**
```python
# Search for API key references
mcp__serena__search_for_pattern(
    substring_pattern="apiKey|api_key",
    context_lines_after=2
)

# Search in specific directory with context
mcp__serena__search_for_pattern(
    substring_pattern="chrome\.runtime\.sendMessage",
    relative_path="src",
    context_lines_before=1,
    context_lines_after=3
)
```

### 2. **Implementation / Modification**

#### `mcp__serena__replace_symbol_body`
**Purpose:** Replace the entire body of an existing function/class. For major overhauls or bug fixes.
**Arguments:**
- `name_path` (required): Symbol to replace
- `relative_path` (required): File containing the symbol
- `body` (required): New symbol body (no leading indentation for first line)

**Example:**
```python
# Replace a function implementation
mcp__serena__replace_symbol_body(
    name_path="translateText",
    relative_path="src/background/api.js",
    body="""async function translateText(text, settings) {
    // New improved implementation
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ text, model: settings.model })
    });
    return response.json();
}"""
)
```

#### `mcp__serena__insert_before_symbol` / `mcp__serena__insert_after_symbol`
**Purpose:** Safely add code before/after existing symbols without breaking structure.
**Arguments:**
- `name_path` (required): Reference symbol
- `relative_path` (required): File containing the symbol
- `body` (required): Code to insert

**Example:**
```python
# Add import at file start (before first symbol)
mcp__serena__insert_before_symbol(
    name_path="handleBackgroundMessage",  # First function in file
    relative_path="src/background/message-handlers.js",
    body="import { newHelper } from './helpers.js';
"
)

# Add new function after existing one
mcp__serena__insert_after_symbol(
    name_path="translateText",
    relative_path="src/background/api.js",
    body="""
async function translateBatch(texts, settings) {
    return Promise.all(texts.map(text => translateText(text, settings)));
}"""
)
```

#### `mcp__serena__list_dir` / `mcp__serena__find_file`
**Purpose:** Navigate and discover files in the project structure.
**Arguments for list_dir:**
- `relative_path` (required): Directory to list (use "." for root)
- `recursive` (required): Whether to list subdirectories recursively

**Arguments for find_file:**
- `file_mask` (required): Filename pattern (supports * and ? wildcards)
- `relative_path` (required): Directory to search in

**Example:**
```python
# List all files in a directory
mcp__serena__list_dir(relative_path="src/background", recursive=false)

# Find all JavaScript files
mcp__serena__find_file(file_mask="*.js", relative_path="src")

# Find specific file pattern
mcp__serena__find_file(file_mask="*handler*.js", relative_path=".")
```

#### `mcp__serena__replace_regex`
**Purpose:** Broad text replacements using regex. Use for non-semantic changes (formatting, renaming, etc).
**Arguments:**
- `relative_path` (required): File to modify
- `regex` (required): Python regex pattern to match
- `repl` (required): Replacement string (supports backreferences like \1, \2)
- `allow_multiple_occurrences` (optional, default: false): Replace all matches

**Example:**
```python
# Rename a variable throughout file
mcp__serena__replace_regex(
    relative_path="popup.js",
    regex="openrouterApiKey",
    repl="openRouterApiKey",
    allow_multiple_occurrences=true
)

# Update log statements
mcp__serena__replace_regex(
    relative_path="src/background/api.js",
    regex="console\.log\('(.*?)'\)",
    repl="console.debug('[API] \1')",
    allow_multiple_occurrences=true
)
```

### 3. **Bug Reproduction / Verification / Quality**

#### Bash tool (built-in)
**Purpose:** Run tests, linters, builds, and other shell commands.
**Example:**
```bash
# Run tests
Bash(command="npm test")

# Run linter
Bash(command="npm run lint")

# Check build
Bash(command="npm run build")
```

#### `mcp__serena__restart_language_server`
**Purpose:** Recovery when external edits or LSP malfunction occur.
**Arguments:** None

**Example:**
```python
# Restart LSP when it hangs or after external changes
mcp__serena__restart_language_server()
```

### 4. **Project Initialization / Context**

#### `mcp__serena__onboarding` / `mcp__serena__check_onboarding_performed`
**Purpose:** Automatically infer build/test steps and key configurations. Always run on first use.
**Arguments:** None for both

**Example:**
```python
# Check if onboarding was done
mcp__serena__check_onboarding_performed()

# If not, run onboarding
mcp__serena__onboarding()
```

#### `mcp__serena__list_memories` / `mcp__serena__write_memory` / `mcp__serena__read_memory` / `mcp__serena__delete_memory`
**Purpose:** Lightweight memory in `.serena/memories/` to persist rules, key paths, etc.

**Arguments for write_memory:**
- `memory_name` (required): Meaningful name for the memory
- `content` (required): Content to save

**Arguments for read_memory:**
- `memory_file_name` (required): Name of memory to read

**Arguments for delete_memory:**
- `memory_file_name` (required): Name of memory to delete

**Arguments for list_memories:** None

**Example:**
```python
# List all memories
mcp__serena__list_memories()

# Save project-specific information
mcp__serena__write_memory(
    memory_name="api_endpoints",
    content="""
    Key API endpoints:
    - OpenRouter: https://openrouter.ai/api/v1/
    - Gemini: https://generativelanguage.googleapis.com/v1beta/
    
    Important files:
    - API logic: src/background/api.js
    - Message handling: src/background/message-handlers.js
    """
)

# Read saved memory
mcp__serena__read_memory(memory_file_name="api_endpoints.md")

# Delete outdated memory
mcp__serena__delete_memory(memory_file_name="old_notes.md")
```

## Serena Memory Tools Usage

This section clarifies how to use Serena memory tools. It documents tool behavior only (not tasks):

- `mcp__serena__list_memories`: Lists available memory files.
- `mcp__serena__read_memory(memory_file_name=...)`: Reads the full content of a memory (e.g., `api_configuration.md`).
- `mcp__serena__write_memory(memory_name=..., content=...)`: Creates or updates a memory with the provided content.
- `mcp__serena__delete_memory(memory_file_name=...)`: Deletes a memory file.

Notes:
- Do not use `mcp__serena__onboarding` to write or update memories; it does not persist content.
- Prefer updating via `mcp__serena__write_memory` rather than deleting memories.

Examples:
```python
# List memories
mcp__serena__list_memories()

# Read a memory
mcp__serena__read_memory(memory_file_name="api_configuration.md")

# Write/update a memory
mcp__serena__write_memory(
    memory_name="api_configuration",
    content="""
    # API Configuration
    (markdown content)
    """
)

# Delete a memory (use sparingly)
mcp__serena__delete_memory(memory_file_name="obsolete.md")
```

## Project Overview

This is a Chrome browser extension (Manifest V3) that translates selected text, full pages, images, Twitter/X.com tweets, and YouTube comments using Large Language Models (LLMs). The extension currently supports OpenRouter, Google Gemini, Cerebras, Z-AI, Ollama, LM Studio, and Chrome Gemini Nano.

## Development Setup

Install development tools with Bun:

```bash
bun install
bun run lint
bun run test
```

Required PNG icons are already committed under `icons/`. Run `scripts/create_icons.sh` only when regenerating icons from `icons/icon.svg`.

## Architecture

### Code Structure
- **`background.js`** - Service worker entry point, imports modularized background scripts
- **`src/background/`** - Modularized background logic:
  - `api.js` - LLM API communication, error handling, fallback logic
  - `message-handlers.js` - Chrome runtime message processing
  - `settings.js` - Settings management with chrome.storage.sync
  - `event-listeners.js` - Chrome extension event handlers (install, context menu, commands)
  - `page-translation-service.js` - Page-wide translation sessions, chunking, progress, continue/cancel handling
  - `selection-translation.js` - Selected text translation and result delivery fallbacks
  - `image-translation.js` - Context-menu image capture and LM Studio image translation flow
  - `streaming.js` - Frame-scoped streaming message delivery helpers
  - `chrome-prompt-client.js` - Offscreen document bridge for Chrome Gemini Nano
  - `logging.js` - Page translation log storage and provider metadata helpers
- **`src/offscreen/`** - Offscreen document runtime:
  - `chrome-prompt-runtime.js` - Chrome Prompt API / Gemini Nano execution environment, loaded by `offscreen.html` as an ES module
- **`src/content/`** - Classic content scripts loaded in `manifest.json` order:
  - `shared.js` - Shared globals, feature settings, utilities, styles
  - `streaming.js` - Content-side stream session rendering
  - `selection.js` - Selection popup, image context capture, loading/result UI
  - `page-translation.js` - Page text snapshot, replacement, progress controls
  - `twitter.js` - Twitter/X button injection, cache, translation rendering
  - `youtube.js` - YouTube comment button injection and rendering
  - `runtime.js` - Runtime message dispatch from background
- **`content.js`** - Content entry point that initializes Twitter/X and YouTube integrations after feature settings load
- **`popup.js`** - Settings UI logic with jQuery/Select2 for model selection

### Key Features
- **Text Selection Translation**: Right-click context menu + keyboard shortcut (Ctrl+Shift+T / Cmd+Shift+T)
- **Twitter Integration**: Auto-injected translation buttons on tweets using MutationObserver
- **YouTube Integration**: Translation buttons for YouTube comments
- **Page Translation**: Full page text node translation via context menu with progress controls
- **Image Translation**: Image context menu flow for LM Studio vision-capable models
- **Multi-provider Support**: OpenRouter, Google Gemini, Cerebras, Z-AI, Ollama, LM Studio, and Chrome Gemini Nano
- **Settings Management**: chrome.storage.sync with fallback defaults and validation
- **CORS Workaround**: Direct API calls for supported providers

### Message Flow
1. Content script → Background script via `chrome.runtime.sendMessage`
2. Background script processes via `message-handlers.js`
3. API calls through `api.js`
4. Results returned to content script for UI display

## Development Notes

- Extension uses Manifest V3 with service worker background script
- Background scripts are ES modules (`"type": "module"` in manifest)
- Settings are stored in `chrome.storage.sync` with default values
- Twitter integration uses MutationObserver for dynamic content
- Select2 library used for enhanced model selection dropdowns
- API key validation includes live testing against actual endpoints
