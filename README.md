# code-forge

This repository hosts a simple React web chat interface for interacting with local Ollama models.

## Web Chat Application

The chat application lives in the `web-app/` directory. Install its dependency and start the server:

```bash
cd web-app
npm install
npm start
```

Open the printed URL (typically `http://localhost:3000`) and begin chatting. The app expects Ollama to be running at `http://localhost:11434` and uses the `llama3` model by default.
