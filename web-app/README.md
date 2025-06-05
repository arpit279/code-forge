# Ollama Web Chat App

This folder contains a minimal React application that communicates with a local Ollama model. React and Babel are loaded from a CDN, so no build step is required.

## Prerequisites
- Node.js and npm must be installed
- An Ollama model running locally at `http://localhost:11434`

## Setup and Running
Install the dependencies (just the static server) and start the app:

```bash
cd web-app
npm install
npm start
```

`npm start` launches a lightweight static server using the `serve` package. By default it prints a URL such as `http://localhost:3000` – open this in your browser to chat.

The left sidebar keeps a history of conversations. Click **New Chat** to start fresh or select any previous chat to review its messages. A drop-down menu lets you pick from installed Ollama models, and messages are sent to the Ollama API at `http://localhost:11434`. Use the toggle next to the selector to switch between light and dark modes.
