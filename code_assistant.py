import ast
from pathlib import Path
import click
import ollama

# Utility to interact with ollama and handle errors gracefully


def ask_llm(prompt: str, model: str) -> str:
    """Send a prompt to the specified Ollama model and return the response."""
    try:
        response = ollama.generate(model=model, prompt=prompt)
        return response.get("response", "")
    except Exception as exc:
        return f"Error communicating with Ollama: {exc}"


def _summarise_python_file(path: Path) -> str:
    """Create a brief summary of a Python file."""
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except Exception:
        return "Could not parse file"

    parts = []
    doc = ast.get_docstring(tree)
    if doc:
        parts.append(doc.splitlines()[0])
    classes = [n.name for n in tree.body if isinstance(n, ast.ClassDef)]
    funcs = [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]
    if classes:
        parts.append("classes: " + ", ".join(classes))
    if funcs:
        parts.append("functions: " + ", ".join(funcs))
    return "; ".join(parts)


@click.group()
@click.option("--path", default=".", help="Path to the project")
@click.option("--model", default="llama3", help="Ollama model name")
@click.pass_context
def cli(ctx, path, model):
    """CLI tool powered by local LLMs via Ollama."""
    ctx.ensure_object(dict)
    ctx.obj["PATH"] = Path(path).resolve()
    ctx.obj["MODEL"] = model
    if not ctx.obj["PATH"].exists():
        raise click.BadParameter(f"Directory {path} does not exist.")


@cli.command()
@click.pass_context
def describe(ctx):
    """Use an LLM to describe the project."""
    path = ctx.obj["PATH"]
    model = ctx.obj["MODEL"]

    readme = path / "README.md"
    snippet = readme.read_text(encoding="utf-8")[:400] if readme.exists() else ""

    summaries = []
    for py_file in sorted(path.rglob("*.py")):
        summary = _summarise_python_file(py_file)
        rel = py_file.relative_to(path)
        summaries.append(f"{rel}: {summary}")

    prompt = (
        "Provide an overall description of this project using the README snippet "
        "and summaries of each Python file.\n\nREADME:\n"
        + snippet
        + "\n\nFile summaries:\n"
        + "\n".join(summaries)
    )
    summary = ask_llm(prompt, model)
    click.echo(summary)


@cli.command()
@click.argument("file")
@click.argument("instruction")
@click.pass_context
def change(ctx, file, instruction):
    """Modify a file according to a natural language instruction."""
    path = ctx.obj["PATH"] / file
    model = ctx.obj["MODEL"]
    if not path.exists():
        raise click.BadParameter(f"{file} does not exist")

    content = path.read_text(encoding="utf-8")
    prompt = (
        "Modify the following Python file according to this instruction: "
        f"{instruction}.\n\n"
        + content
        + "\n---\nReturn only the full modified file."
    )
    new_content = ask_llm(prompt, model)
    click.echo("\nGenerated change:\n")
    click.echo(new_content)
    if click.confirm("Apply these changes?", default=False):
        path.write_text(new_content, encoding="utf-8")
        click.echo("File updated.")
    else:
        click.echo("No changes made.")


@cli.command()
@click.argument("file")
@click.pass_context
def fix(ctx, file):
    """Ask the model to fix bugs in the given file."""
    path = ctx.obj["PATH"] / file
    model = ctx.obj["MODEL"]
    if not path.exists():
        raise click.BadParameter(f"{file} does not exist")
    content = path.read_text(encoding="utf-8")
    prompt = (
        "Identify and fix bugs in the following Python file. Return the corrected file only.\n\n"
        + content
    )
    new_content = ask_llm(prompt, model)
    click.echo("\nSuggested fixes:\n")
    click.echo(new_content)
    if click.confirm("Apply these fixes?", default=False):
        path.write_text(new_content, encoding="utf-8")
        click.echo("File updated.")
    else:
        click.echo("No changes made.")


@cli.command()
@click.argument("file")
@click.argument("feature")
@click.pass_context
def enhance(ctx, file, feature):
    """Add a feature to the specified file."""
    path = ctx.obj["PATH"] / file
    model = ctx.obj["MODEL"]
    if not path.exists():
        raise click.BadParameter(f"{file} does not exist")
    content = path.read_text(encoding="utf-8")
    prompt = (
        "Enhance the following Python file with this feature: "
        f"{feature}.\n\n"
        + content
        + "\n---\nReturn only the full enhanced file."
    )
    new_content = ask_llm(prompt, model)
    click.echo("\nProposed enhancement:\n")
    click.echo(new_content)
    if click.confirm("Apply this enhancement?", default=False):
        path.write_text(new_content, encoding="utf-8")
        click.echo("File updated.")
    else:
        click.echo("No changes made.")


if __name__ == "__main__":
    cli(obj={})
