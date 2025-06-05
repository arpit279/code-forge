const API_URL = 'http://localhost:11434/api/generate';
const MODEL = 'llama3';

function ChatApp() {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput] = React.useState('');
  const inputRef = React.useRef(null);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    const userMsg = { sender: 'user', text };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: text }),
      });
      const data = await res.json();
      const botMsg = { sender: 'bot', text: data.response || 'No response' };
      setMessages((msgs) => [...msgs, botMsg]);
    } catch (err) {
      setMessages((msgs) => [
        ...msgs,
        { sender: 'bot', text: 'Error contacting Ollama: ' + err },
      ]);
    }
    inputRef.current.focus();
  };

  return (
    <div id="chat">
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.sender}`}>{
            m.sender === 'user' ? 'You: ' : 'Bot: '
          }{m.text}</div>
        ))}
      </div>
      <input
        type="text"
        value={input}
        ref={inputRef}
        placeholder="Ask something..."
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') sendMessage();
        }}
      />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}

ReactDOM.render(<ChatApp />, document.getElementById('root'));
