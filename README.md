# code-forge

This repository provides simple command line tools for working with projects.

## Existing CLI

`application.py` offers basic commands such as describing a project, generating tests and adding a small enhancement to a file.

## New LLM powered CLI

`code_assistant.py` is a more advanced helper that integrates with [Ollama](https://ollama.com/).
It exposes several commands:

- `describe` – summarise the repository using an open-source model.
- `change` – apply user defined modifications to a file with the help of an LLM.
- `fix` – attempt to fix bugs in a file.
- `enhance` – add new features to a file.

All commands take `--path` to specify the project root and `--model` to choose an Ollama model (defaults to `llama3`). The tool will prompt for confirmation before overwriting any files.

## Running the tools

Both CLIs are standard Python scripts. Run them with `python` and pass the desired command line arguments. Examples:

```bash
# Describe a repository located in ./my_project
python application.py --path ./my_project describe

# Add a simple enhancement to file.py inside my_project
python application.py --path ./my_project enhance file.py

# Generate a basic test for file.py
python application.py --path ./my_project test file.py
```

The LLM-powered helper works similarly and also accepts `--model`:

```bash
# Summarise the project using the default model
python code_assistant.py --path ./my_project describe

# Ask the model to fix bugs in file.py using the "mistral" model
python code_assistant.py --path ./my_project --model mistral fix file.py
```
