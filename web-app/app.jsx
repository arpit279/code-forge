const API_URL = 'http://localhost:11434/api/generate';
const TAGS_URL = 'http://localhost:11434/api/tags';

function ChatApp() {
  const [conversations, setConversations] = React.useState([
    { id: 1, messages: [] },
  ]);
  const [current, setCurrent] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [models, setModels] = React.useState([]);
  const [model, setModel] = React.useState('llama3');
  const [darkMode, setDarkMode] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch(TAGS_URL);
        const data = await res.json();
        if (data.models) {
          const names = data.models.map(m => m.name);
          setModels(names);
          if (names.length && !names.includes(model)) {
            setModel(names[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch models', err);
      }
    }
    fetchModels();
  }, []);

  React.useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    const userMsg = { sender: 'user', text };
    setConversations((cs) => {
      const updated = [...cs];
      updated[current].messages = [...updated[current].messages, userMsg];
      return updated;
    });
    setInput('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text, stream: false }),
      });
      const data = await res.json();
      let responseText = data.response || 'No response';
      const thinkParts = [];
      const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
      let m;
      while ((m = thinkRegex.exec(responseText))) {
        thinkParts.push(m[1].trim());
      }
      responseText = responseText.replace(thinkRegex, '').trim();

      const botMsg = {
        sender: 'bot',
        text: responseText,
        think: thinkParts.join('\n'),
        showThink: false,
      };
      setConversations((cs) => {
        const updated = [...cs];
        updated[current].messages = [...updated[current].messages, botMsg];
        return updated;
      });
    } catch (err) {
      setConversations((cs) => {
        const updated = [...cs];
        updated[current].messages = [
          ...updated[current].messages,
          { sender: 'bot', text: 'Error contacting Ollama: ' + err },
        ];
        return updated;
      });
    }
    inputRef.current.focus();
  };

  const newChat = () => {
    setConversations((cs) => [...cs, { id: cs.length + 1, messages: [] }]);
    setCurrent(conversations.length);
    setInput('');
    inputRef.current.focus();
  };

  const toggleThink = (index) => {
    setConversations((cs) => {
      const updated = [...cs];
      const msg = { ...updated[current].messages[index] };
      msg.showThink = !msg.showThink;
      updated[current].messages[index] = msg;
      return updated;
    });
  };

  const messages = conversations[current].messages;

  return (
    <React.Fragment>
      <div className="history">
        <button onClick={newChat}>New Chat</button>
        {conversations.map((c, i) => (
          <div
            key={c.id}
            className={`history-item ${i === current ? 'active' : ''}`}
            onClick={() => setCurrent(i)}
          >
            {`Chat ${c.id}`}
          </div>
        ))}
      </div>
      <div id="chat">
        <div className="model-select">
          <label>
            Model:
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button className="mode-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.sender}`}>
              <strong>{m.sender === 'user' ? 'You:' : 'Bot:'}</strong>
              <span
                className="msg-text"
                dangerouslySetInnerHTML={{ __html: marked.parse(m.text) }}
              />
              {m.think && (
                <div className="thinking-block">
                  <button
                    className="think-toggle"
                    onClick={() => toggleThink(i)}
                  >
                    {m.showThink ? 'Hide \u25B2' : 'Show \u25BC'}
                  </button>
                  {m.showThink && (
                    <div
                      className="thinking"
                      dangerouslySetInnerHTML={{ __html: marked.parse(m.think) }}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="input-row">
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
      </div>
    </React.Fragment>
  );
}

ReactDOM.render(<ChatApp />, document.getElementById('root'));
