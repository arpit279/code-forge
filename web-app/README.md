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

`npm start` launches a lightweight static server using the `serve` package. By default it prints a URL such as `http://localhost:3000` – open this in your browser to chat. A drop-down menu allows you to select from installed Ollama models. Messages are sent to the Ollama API at `http://localhost:11434`.
