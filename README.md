# SillyTavern-WI-FunctionCall

A SillyTavern extension that lets AI models activate World Info / lorebook entries on demand via function calling, instead of relying on keyword matching or static context injection.

## Why this exists

Standard WI activation has three modes: always-on, keyword-triggered, and vectorized (embedding similarity). Each fires automatically based on its own criteria.

This extension adds **on-demand activation as an additional trigger** on top of any existing mode. You mark specific WI entries as tool-callable, and the model decides for itself when to request them. When it does, it calls the `activateWI` tool — the extension then force-activates the requested entries, injecting their content into context before the model continues generating.

This is especially useful for:

- **Dynamic instructions** — system prompts or behavior guidelines the model fetches only when entering a specific scenario
- **Agent simulation** — WI entries that define agent roles or capabilities, activated when the model decides to "become" that agent
- **Language-agnostic triggering** — activation works regardless of what language the conversation is in
- **Quick Reply chains** — WI entries that trigger Quick Replies, activated on demand rather than by keyword

## Requirements

- SillyTavern
- An API backend that supports function/tool calling (e.g. OpenAI, Claude, compatible local models via OpenAI-format endpoints)

## Installation

1. In SillyTavern, open the **Extensions** panel (puzzle piece icon).
2. Go to the **Install extension** tab.
3. Paste the repository URL:
   ```
   https://github.com/Culpeo/SillyTavern-WI-FunctionCall
   ```
4. Click **Install**. The extension loads automatically on the next page refresh.

## Configuration

Open **Extensions → WI Function Call** to access global settings:

| Setting | Description | Default |
|---|---|---|
| **Enable WI Function Call** | Master on/off switch for the entire extension | On |
| **Max tool-callable entries** | Maximum number of entries exposed to the model in a single tool registration. Raise if you have many tool-callable entries. | 10 |
| **Function description prefix** | The text prepended to the tool description before the list of entry names. Edit this to change how the model understands the tool's purpose. | *(see below)* |

The default function description prefix is:
```
This function loads further WI entries on demand. It accepts an array with one or more of the following strings:
```
The extension appends the list of available entry names and their descriptions automatically.

## Usage

### Marking an entry as tool-callable

1. Open the **World Info** editor and expand any lorebook entry.
2. Check **Activate via tool call** — a new section appears below the checkbox.
3. Fill in:
   - **Tool name** — a short identifier the model uses to request this entry (e.g. `get_mood`, `load_combat_rules`).
   - **Description** — one or two sentences telling the model when it should request this entry (e.g. `Load this when the scene shifts to combat to get the combat rules.`).
4. Save the lorebook. The tool is registered automatically.

A warning icon (⚠️) appears next to the checkbox if the current API does not support tool calling or if "Enable WI Function Call" is disabled.

### How it works at runtime

When the model generates a response, it sees the `activateWI` tool with a description listing all enabled, tool-callable entries. If it decides one or more entries are relevant, it calls the tool with an array of names. SillyTavern injects those entries into context (using the same path as vectorized entries), and the model resumes generation with the new content available.

Multiple entries can be activated in a single call by passing several names in the array.

### Example

Suppose you have a lorebook with these entries marked as tool-callable:

| Tool name | Description |
|---|---|
| `combat_rules` | Load when a fight begins to get the combat resolution rules. |
| `npc_lord_harwick` | Load when Lord Harwick appears or is mentioned by name. |
| `world_magic_system` | Load when the conversation involves spellcasting or magical effects. |

The model will see a tool described roughly as:

```
This function loads further WI entries on demand. It accepts an array with one or more of the following strings:
"combat_rules": Load when a fight begins to get the combat resolution rules.
"npc_lord_harwick": Load when Lord Harwick appears or is mentioned by name.
"world_magic_system": Load when the conversation involves spellcasting or magical effects.
```

If the user's message triggers a sword fight, the model may call `activateWI(["combat_rules"])` before writing its response. It then receives the combat rules and incorporates them naturally.

## Features

- **Per-entry toggle** — each WI entry independently opts in or out of tool-callable mode; standard entries are unaffected
- **Custom tool name and description per entry** — the model gets entry-specific descriptions to guide its selection
- **Configurable description prefix** — the shared preamble for the tool's description is fully editable
- **Entry cap** — a configurable limit prevents the tool description from growing unmanageably large
- **Automatic re-registration** — the tool updates whenever a lorebook is saved, the active lorebook changes, or the chat switches
- **Warning indicator** — a visible warning appears on any entry whose tool-callable flag is set but cannot fire (unsupported API or function calls disabled)
- **No interference with standard WI** — keyword triggers, constant entries, and all other WI mechanics work exactly as before

## Tips

- **Multi-turn persistence** — by default a force-activated entry lasts only for the turn it was triggered. If you want the entry to stay active across subsequent turns, enable the **Sticky** option on it.
- **Deactivating sticky entries** — use an Inclusion Group to allow one entry to displace another. When the model activates a new entry in the same group, the previously sticky one is pushed out.

## Limitations

- Tool calling must be supported and enabled by the current API/model. The extension does nothing when `ToolManager.isToolCallingSupported()` returns false.
- The entry cap (default 10) limits how many entries are offered to the model at once. Entries are taken in SillyTavern's sorted order; entries beyond the cap are silently excluded.
- Disabled entries (the **Disable** toggle in the WI editor) are never offered to the model even if their tool-callable flag is set.

## License

GPL-3.0 license
