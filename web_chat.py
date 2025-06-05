"""Simple Flask app to chat with a local Ollama model."""
from flask import Flask, request, jsonify
import ollama

app = Flask(__name__)

HTML_PAGE = """
<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'>
<title>Ollama Chat</title>
<style>
body {font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto;}
#messages {border: 1px solid #ccc; height: 400px; overflow-y: auto; padding: 10px; margin-bottom: 10px;}
.input-row {display: flex; gap: 10px;}
input {flex: 1; padding: 8px;}
button {padding: 8px 16px;}
.message {margin-bottom: 10px;}
.user {font-weight: bold;}
.bot {color: green;}
</style>
</head>
<body>
<div id='messages'></div>
<div class='input-row'>
<input id='prompt' type='text' placeholder='Ask something...'>
<button onclick='send()'>Send</button>
</div>
<script>
async function send() {
  const box = document.getElementById('prompt');
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  add('user', text);
  const res = await fetch('/chat', {method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt:text})});
  const data = await res.json();
  add('bot', data.response);
}
function add(role, text){
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.textContent = text;
  document.getElementById('messages').appendChild(div);
}
</script>
</body>
</html>
"""

@app.get("/")
def index():
    return HTML_PAGE

@app.post("/chat")
def chat():
    prompt = request.json.get("prompt", "")
    try:
        result = ollama.generate(model="llama3", prompt=prompt)
        reply = result.get("response", "")
    except Exception as exc:
        reply = f"Error contacting Ollama: {exc}"
    return jsonify(response=reply)

if __name__ == "__main__":
    app.run(debug=True)
