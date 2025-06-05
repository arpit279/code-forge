# code-forge

This repository provides simple command line tools for working with projects.

## CLI

`code_assistant.py` is a helper script that integrates with [Ollama](https://ollama.com/).
It exposes several commands:

- `describe` – summarise the repository using an open-source model.
- `change` – apply user defined modifications to a file with the help of an LLM.
- `fix` – attempt to fix bugs in a file.
- `enhance` – add new features to a file.

All commands take `--path` to specify the project root and `--model` to choose an Ollama model (defaults to `llama3`). The tool will prompt for confirmation before overwriting any files. The `describe` command reads every Python file recursively and summarises the intent of the code using module docstrings, class and function names.

## Running the tools

Both CLIs are standard Python scripts. Run them with `python` and pass the desired command line arguments. Examples:

```bash
# Describe a repository located in ./my_project
python code_assistant.py --path ./my_project describe

# Add a simple enhancement to file.py inside my_project
python code_assistant.py --path ./my_project enhance file.py

# Ask the model to fix bugs in file.py using the "mistral" model
python code_assistant.py --path ./my_project --model mistral fix file.py
```

## Web Chat Application

A browser-based chat interface is located in `web-app/`. It uses React to send messages directly to your local Ollama instance.

To try it out, install the small `serve` dependency and launch the app:

```bash
cd web-app
npm install
npm start
```

Open `http://localhost:3000` (or the port printed by `serve`) and begin chatting. The app expects Ollama to be running on `http://localhost:11434` and uses the `llama3` model by default.
