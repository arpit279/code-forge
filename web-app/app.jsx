const API_URL = 'http://localhost:11434/api/generate';
const TAGS_URL = 'http://localhost:11434/api/tags';
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function ChatApp() {
  const [conversations, setConversations] = React.useState([
    { id: 1, messages: [] },
  ]);
  const [current, setCurrent] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [models, setModels] = React.useState([]);
  const [model, setModel] = React.useState('llama3');
  const [darkMode, setDarkMode] = React.useState(false);
  const [attachments, setAttachments] = React.useState([]);
  const [mcpModalOpen, setMcpModalOpen] = React.useState(false);
  const [mcpJson, setMcpJson] = React.useState('');
  const [mcpError, setMcpError] = React.useState('');
  const [mcpServers, setMcpServers] = React.useState([]);
  const [tools, setTools] = React.useState([]);
  const [editing, setEditing] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const editorRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const messagesRef = React.useRef(null);

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

    async function fetchMcp() {
      try {
        const res = await fetch('/api/mcp-config');
        const data = await res.json();
        if (data.servers) {
          setMcpServers(data.servers);
          const serverTools = data.servers.flatMap(s => s.tools || []);
          setTools(serverTools);
        }
      } catch (err) {
        console.error('Failed to load MCP config', err);
      }
    }
    fetchMcp();
  }, []);

  React.useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const addMcpServer = async () => {
    try {
      const obj = JSON.parse(mcpJson);
      if (!obj.name) throw new Error('Server entry must include a name');
      const res = await fetch('/api/mcp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMcpServers(data.servers);
      const serverTools = data.servers.flatMap(s => s.tools || []);
      setTools(serverTools);
      setMcpJson('');
      setMcpError('');
      setEditing(null);
      setMcpModalOpen(false);
    } catch (err) {
      setMcpError(err.message);
    }
  };

  const handleMcpJsonChange = (e) => {
    const val = e.target.value;
    setMcpJson(val);
    try {
      JSON.parse(val);
      setMcpError('');
    } catch (err) {
      setMcpError(err.message);
    }
  };

  React.useEffect(() => {
    if (mcpModalOpen && editorRef.current) {
      const cm = CodeMirror.fromTextArea(editorRef.current, {
        mode: 'application/json',
        lineNumbers: true,
      });
      cm.on('change', (cmInstance) => {
        handleMcpJsonChange({ target: { value: cmInstance.getValue() } });
      });
      cm.setValue(mcpJson);
      return () => cm.toTextArea();
    }
  }, [mcpModalOpen]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isLoading) return; // Prevent multiple requests
    
    const fileText = attachments
      .map((f) => `\n[File: ${f.name}]\n${f.data}`)
      .join('\n');
    const prompt = text + fileText;
    const userMsg = { sender: 'user', text, attachments: attachments.map(a => a.name) };
    
    // Add user message immediately
    setConversations((cs) => {
      const updated = [...cs];
      updated[current].messages = [...updated[current].messages, userMsg];
      return updated;
    });
    
    setInput('');
    setIsLoading(true);
    
    // Add thinking message for models that process/reason
    const thinkingModels = ['llama3', 'deepseek', 'qwen', 'claude']; // Add model names that show thinking
    const shouldShowThinking = thinkingModels.some(modelName => model.toLowerCase().includes(modelName.toLowerCase()));
    
    if (shouldShowThinking) {
      const thinkingMsg = {
        sender: 'bot',
        text: '',
        isThinking: true,
      };
      setConversations((cs) => {
        const updated = [...cs];
        updated[current].messages = [...updated[current].messages, thinkingMsg];
        return updated;
      });
    }
    
    // Scroll to bottom to show user message and thinking animation
    setTimeout(() => {
      if (messagesRef.current) {
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      }
    }, 100);
    
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
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
        // Remove thinking message if it exists and replace with actual response
        const messages = updated[current].messages;
        const lastMessage = messages[messages.length - 1];
        if (shouldShowThinking && lastMessage && lastMessage.isThinking) {
          messages[messages.length - 1] = botMsg;
        } else {
          messages.push(botMsg);
        }
        return updated;
      });
    } catch (err) {
      setConversations((cs) => {
        const updated = [...cs];
        const errorMsg = { sender: 'bot', text: 'Error contacting Ollama: ' + err };
        
        // Remove thinking message if it exists and replace with error
        const messages = updated[current].messages;
        const lastMessage = messages[messages.length - 1];
        if (shouldShowThinking && lastMessage && lastMessage.isThinking) {
          messages[messages.length - 1] = errorMsg;
        } else {
          messages.push(errorMsg);
        }
        return updated;
      });
    }
    
    setIsLoading(false);
    setAttachments([]);
    inputRef.current.focus();
    
    // Scroll to bottom to show response
    setTimeout(() => {
      if (messagesRef.current) {
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      }
    }, 100);
  };

  const newChat = () => {
    setConversations((cs) => [...cs, { id: cs.length + 1, messages: [] }]);
    setCurrent(conversations.length);
    setInput('');
    inputRef.current.focus();
  };

  const deleteMcpServer = async (name) => {
    try {
      const res = await fetch(`/api/mcp-config/${name}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMcpServers(data.servers);
      const serverTools = data.servers.flatMap(s => s.tools || []);
      setTools(serverTools);
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const startEdit = (srv) => {
    setEditing(srv.name);
    setMcpJson(JSON.stringify(srv, null, 2));
    setMcpModalOpen(true);
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    const processed = await Promise.all(
      files.map(async (file) => {
        if (file.type === 'application/pdf') {
          const buffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map((it) => it.str).join(' ') + '\n';
          }
          return { name: file.name, data: text };
        } else if (file.type.startsWith('text/')) {
          const text = await file.text();
          return { name: file.name, data: text };
        } else {
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
          return { name: file.name, data: dataUrl };
        }
      })
    );
    setAttachments((prev) => [...prev, ...processed]);
    e.target.value = '';
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
        <div className="history-header">
          <h3 className="history-title">History</h3>
          <button className="new-chat-icon" onClick={newChat} title="New Chat">
            📝
          </button>
        </div>
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
          <button className="mcp-button" onClick={() => setMcpModalOpen(true)}>
            ⚙
          </button>
        </div>
        {tools.length > 0 && (
          <div className="tools-panel">
            {tools.map((t, idx) => (
              <span key={idx} className="tool">{t.name || t}</span>
            ))}
          </div>
        )}
        <div className="messages" ref={messagesRef}>
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.sender} ${m.isThinking ? 'thinking-message' : ''}`}>
              {m.sender === 'user' && <strong>You:</strong>}
              {m.isThinking ? (
                <div className="thinking-animation">
                  <span className="thinking-text">Thinking</span>
                  <div className="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              ) : (
                <span
                  className="msg-text"
                  dangerouslySetInnerHTML={{ __html: marked.parse(m.text) }}
                />
              )}
              {m.attachments && m.attachments.length > 0 && (
                <div className="msg-files">
                  {m.attachments.map((a, j) => (
                    <div key={j} className="msg-file">{a}</div>
                  ))}
                </div>
              )}
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
          <label className="attach-button">
            📎
            <input type="file" multiple onChange={handleFiles} style={{ display: 'none' }} />
          </label>
          <input
            type="text"
            value={input}
            ref={inputRef}
            placeholder="Ask something..."
            disabled={isLoading}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading) sendMessage();
            }}
          />
          <button onClick={sendMessage} disabled={isLoading}>
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((a, idx) => (
              <span key={idx} className="attachment-item">{a.name}</span>
            ))}
          </div>
        )}
        {mcpModalOpen && (
          <div className="modal-overlay">
            <div className="modal">
              <h2>MCP Server Configuration</h2>
              <div className="server-list">
                {mcpServers.map((s) => (
                  <div key={s.name} className="server-item">
                    <span>{s.name}</span>
                    <button onClick={() => startEdit(s)}>Edit</button>
                    <button onClick={() => deleteMcpServer(s.name)}>Delete</button>
                  </div>
                ))}
              </div>
              <textarea
                ref={editorRef}
                defaultValue={mcpJson}
                onChange={handleMcpJsonChange}
                placeholder='{"name":"salesforce","command":"/path/to/python","args":["/path/to/main.py"],"tools":[],"enabled":true}'
              />
              {mcpError && <div className="error">{mcpError}</div>}
              <div className="modal-buttons">
                <button onClick={addMcpServer}>{editing ? 'Save Changes' : 'Add Server'}</button>
                <button onClick={() => { setMcpModalOpen(false); setMcpJson(''); setEditing(null); setMcpError(''); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </React.Fragment>
  );
}

ReactDOM.render(<ChatApp />, document.getElementById('root'));
