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

`npm start` launches a lightweight static server using the `serve` package. By default it prints a URL such as `http://localhost:3000` – open this in your browser and begin chatting. Messages are sent to the Ollama API at `http://localhost:11434` using the model configured in `app.jsx`.

Feel free to edit `API_URL` or `MODEL` in `app.jsx` to point at a different Ollama instance or model.
