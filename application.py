# python3

#!/usr/bin/env python3
import os
from pathlib import Path
import click

# Root directory for the project (default to current dir)
@click.group()
@click.option('--path', default='.', help='Path to the project repository')
@click.pass_context
def cli(ctx, path):
    """A simple CLI tool to analyze and modify a project repository."""
    ctx.ensure_object(dict)
    ctx.obj['PATH'] = Path(path).resolve()
    if not ctx.obj['PATH'].exists():
        raise click.BadParameter(f"Directory {path} does not exist.")

# Command to describe the project
@cli.command()
@click.pass_context
def describe(ctx):
    """Describe the project based on README and code structure."""
    project_path = ctx.obj['PATH']
    readme = project_path / 'README.md'
    description = []

    # Read README if it exists
    if readme.exists():
        with open(readme, 'r', encoding='utf-8') as f:
            content = f.read(200)  # First 200 chars for brevity
            description.append(f"README snippet: {content}...")
    else:
        description.append("No README.md found.")

    # Analyze code files
    py_files = list(project_path.rglob('*.py'))
    if py_files:
        description.append(f"Found {len(py_files)} Python files:")
        for py_file in py_files[:3]:  # Limit to 3 for output brevity
            with open(py_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                funcs = [line.strip() for line in lines if line.strip().startswith('def ')]
                description.append(f"  {py_file.name}: {len(lines)} lines, {len(funcs)} functions")
    else:
        description.append("No Python files found.")

    click.echo("\n".join(description))

# Command to enhance code (e.g., add a function)
@cli.command()
@click.argument('filename')
@click.pass_context
def enhance(ctx, filename):
    """Add a simple function to a specified file."""
    project_path = ctx.obj['PATH']
    file_path = project_path / filename

    if not file_path.exists():
        raise click.BadParameter(f"File {filename} does not exist.")
    if not file_path.suffix == '.py':
        raise click.BadParameter("Only .py files are supported for now.")

    new_function = "\n\ndef new_feature():\n    \"\"\"A new feature added by the CLI tool.\"\"\"\n    print(\"Hello from the new feature!\")\n"
    with open(file_path, 'a', encoding='utf-8') as f:
        f.write(new_function)
    click.echo(f"Added new_feature() to {filename}")

# Command to write a test file
@cli.command()
@click.argument('filename')
@click.pass_context
def test(ctx, filename):
    """Generate a basic test file for a specified Python file."""
    project_path = ctx.obj['PATH']
    src_file = project_path / filename
    test_file = project_path / f"test_{filename}"

    if not src_file.exists():
        raise click.BadParameter(f"File {filename} does not exist.")
    if not src_file.suffix == '.py':
        raise click.BadParameter("Only .py files are supported for now.")

    test_content = f"""import unittest
from {src_file.stem} import *

class Test{src_file.stem.capitalize()}(unittest.TestCase):
    def test_basic(self):
        self.assertTrue(True)  # Replace with real tests

if __name__ == '__main__':
    unittest.main()
"""
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_content)
    click.echo(f"Created test file: {test_file.name}")

if __name__ == '__main__':
    cli(obj={})