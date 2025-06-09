# Ollama Web Chat App

This folder contains a React application that communicates with a local Ollama model.
React and Babel are loaded from CDNs so no build step is required.

## Prerequisites
- Node.js and npm must be installed
- An Ollama model running locally at `http://localhost:11434`

## Setup and Running
Install dependencies and start the bundled server:

```bash
cd web-app
npm install
npm start
```

`npm start` launches a small Express server that serves the static files and
manages the `mcp-config.json` file in the project root. By default it prints a
URL such as `http://localhost:3000` – open this in your browser to chat.

The left sidebar keeps a history of conversations. Click **New Chat** to start a
fresh one or select a previous chat to review it. A drop-down menu lets you pick
from installed Ollama models. Use the toggle next to the selector to switch
between light and dark modes. Attach files with the paperclip icon; PDFs are
converted to text in the browser.

Press the gear icon to manage MCP servers. The dialog shows the current servers
and allows you to add, edit or remove entries. The configuration is stored in
`mcp-config.json` and tools from enabled servers appear below the model
selector.

Example entry for `mcp-config.json`:

```json
{
  "name": "salesforce",
  "url": "http://localhost:8080",
  "command": "/path/to/python",
  "args": ["/path/to/salesforce-mcp-connector/main.py"],
  "tools": ["query"],
  "enabled": true
}
```
