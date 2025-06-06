# code-forge

This repository hosts a simple React web chat interface for interacting with local Ollama models.

## Web Chat Application

The chat application lives in the `web-app/` directory. Install its dependency and start the server:

```bash
cd web-app
npm install
npm start
```

Open the printed URL (typically `http://localhost:3000`) and begin chatting. The app expects Ollama to be running at `http://localhost:11434`. Use the drop-down at the top of the page to choose from your locally installed models. Previous conversations are listed in a sidebar where you can start a **New Chat** or revisit earlier sessions. A button beside the selector toggles between light and dark modes. Use the paperclip icon next to the input box to attach files to your prompt. Bot responses may include a hidden "thinking" section wrapped in `<think>` tags; click the arrow next to any reply to reveal or hide this analysis.
