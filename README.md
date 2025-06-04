# code-forge

This repository provides simple command line tools for working with projects.

## Existing CLI

`application.py` offers basic commands such as describing a project, generating
tests and adding a small enhancement to a file.

## New LLM powered CLI

`code_assistant.py` is a more advanced helper that integrates with [Ollama](https://ollama.com/).
It exposes several commands:

- `describe` – summarise the repository using an open-source model.
- `change` – apply user defined modifications to a file with the help of an LLM.
- `fix` – attempt to fix bugs in a file.
- `enhance` – add new features to a file.

All commands take `--path` to specify the project root and `--model` to choose
an Ollama model (defaults to `llama3`). The tool will prompt for confirmation
before overwriting any files.
