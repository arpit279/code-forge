const API_URL = 'http://localhost:11434/api/generate';
const TAGS_URL = 'http://localhost:11434/api/tags';
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function ChatApp() {
  const [conversations, setConversations] = React.useState([
    { id: 1, name: 'New Chat', messages: [] },
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
  const [mcpTools, setMcpTools] = React.useState([]);
  const [editing, setEditing] = React.useState(null);
  const [mcpTesting, setMcpTesting] = React.useState(false);
  const [connectionStatus, setConnectionStatus] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [mcpEnabled, setMcpEnabled] = React.useState(true);
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
    
    async function fetchMcpTools() {
      try {
        const res = await fetch('/api/mcp-tools');
        const data = await res.json();
        setMcpTools(data.tools || []);
      } catch (err) {
        console.error('Failed to load MCP tools', err);
      }
    }
    
    fetchMcp();
    fetchMcpTools();
  }, []);

  React.useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const addMcpServer = async () => {
    try {
      setMcpTesting(true);
      setMcpError('');
      setConnectionStatus(null);
      
      const obj = JSON.parse(mcpJson);
      
      const res = await fetch('/api/mcp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj),
      });
      
      const data = await res.json();
      
      if (data.error) {
        if (data.details) {
          throw new Error(`${data.error}: ${data.details.join(', ')}`);
        }
        throw new Error(data.error);
      }
      
      // Set connection status based on test results
      if (data.connectionTest) {
        setConnectionStatus({
          success: data.connectionTest.success,
          message: data.connectionTest.message || data.connectionTest.error,
          serverName: obj.name
        });
      }
      
      setMcpServers(data.servers);
      const serverTools = data.servers.flatMap(s => s.tools || []);
      setTools(serverTools);
      setMcpJson('');
      setMcpError('');
      setEditing(null);
      
      // Refresh MCP tools
      const toolsRes = await fetch('/api/mcp-tools');
      const toolsData = await toolsRes.json();
      setMcpTools(toolsData.tools || []);
      
      // Only close modal if connection was successful or user wants to save anyway
      if (data.connectionTest && data.connectionTest.success) {
        setTimeout(() => setMcpModalOpen(false), 2000); // Show success message for 2 seconds
      }
    } catch (err) {
      setMcpError(err.message);
      setConnectionStatus(null);
    } finally {
      setMcpTesting(false);
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

  const generateConversationName = (userText) => {
    // Handle empty or very short text
    if (!userText || userText.trim().length < 3) {
      return 'New Chat';
    }
    
    // Remove common words and extract key terms
    const stopWords = ['what', 'how', 'why', 'when', 'where', 'who', 'can', 'could', 'would', 'should', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'tell', 'show', 'give', 'get', 'make', 'help', 'please', 'thanks', 'hello', 'hi'];
    
    // Clean and split the text
    const words = userText
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
    
    // If no meaningful words found, try to use first few words of original text
    if (words.length === 0) {
      const firstWords = userText.trim().split(/\s+/).slice(0, 3);
      const title = firstWords
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      return title.length > 25 ? title.substring(0, 22) + '...' : title;
    }
    
    // Take first 3-4 meaningful words
    const keyWords = words.slice(0, 4);
    
    // Capitalize first letter of each word
    const title = keyWords
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Limit title length for display
    return title.length > 25 ? title.substring(0, 22) + '...' : title;
  };

  const copyToClipboard = async (text, buttonElement) => {
    try {
      await navigator.clipboard.writeText(text);
      
      // Visual feedback
      const originalText = buttonElement.innerHTML;
      buttonElement.innerHTML = '✓';
      buttonElement.style.color = '#10b981';
      
      setTimeout(() => {
        buttonElement.innerHTML = originalText;
        buttonElement.style.color = '';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const addCopyButtons = (htmlString) => {
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    // Find all pre elements (code blocks)
    const preElements = tempDiv.querySelectorAll('pre');
    
    preElements.forEach((pre, index) => {
      // Create wrapper div for positioning
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      
      // Create copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-code-button';
      copyButton.innerHTML = '📋';
      copyButton.title = 'Copy code';
      copyButton.setAttribute('data-code-index', index);
      
      // Wrap the pre element
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      wrapper.appendChild(copyButton);
    });
    
    return tempDiv.innerHTML;
  };

  React.useEffect(() => {
    // Add click listeners for copy buttons after messages update
    const copyButtons = document.querySelectorAll('.copy-code-button');
    copyButtons.forEach(button => {
      const codeIndex = button.getAttribute('data-code-index');
      const wrapper = button.parentElement;
      const preElement = wrapper.querySelector('pre');
      
      if (preElement) {
        const handleClick = () => {
          const codeText = preElement.textContent || preElement.innerText;
          copyToClipboard(codeText, button);
        };
        
        button.removeEventListener('click', handleClick); // Remove existing listener
        button.addEventListener('click', handleClick);
      }
    });
  }, [conversations, current]); // Re-run when messages change

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isLoading) return; // Prevent multiple requests
    
    const fileText = attachments
      .map((f) => `\n[File: ${f.name}]\n${f.data}`)
      .join('\n');
    const prompt = text + fileText;
    const userMsg = { sender: 'user', text, attachments: attachments.map(a => a.name) };
    
    // Add user message immediately and name conversation if it's the first message
    setConversations((cs) => {
      const updated = [...cs];
      const currentConversation = updated[current];
      currentConversation.messages = [...currentConversation.messages, userMsg];
      
      // If this is the first message, generate a name for the conversation
      if (currentConversation.messages.length === 1) {
        currentConversation.name = generateConversationName(text);
      }
      
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
      // Use the new chat endpoint that handles MCP tool integration
      const messages = [
        { role: 'user', content: prompt }
      ];
      
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          model: model,
          tools: mcpEnabled && mcpTools.length > 0 ? mcpTools : undefined
        }),
      });
      const data = await res.json();
      let responseText = data.response || 'No response';
      
      // If tools were used, the response already includes tool results
      if (data.toolsUsed) {
        console.log('Tools were used in this response:', data.toolResults);
      }
      
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
    setConversations((cs) => [...cs, { id: cs.length + 1, name: 'New Chat', messages: [] }]);
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

  const testMcpServer = async (serverName) => {
    try {
      setMcpTesting(true);
      const res = await fetch(`/api/mcp-config/${serverName}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      setConnectionStatus({
        success: data.connectionTest.success,
        message: data.connectionTest.message || data.connectionTest.error,
        serverName: serverName
      });
      
      // Refresh server list to show updated status
      const configRes = await fetch('/api/mcp-config');
      const configData = await configRes.json();
      setMcpServers(configData.servers);
      
      // Refresh MCP tools
      const toolsRes = await fetch('/api/mcp-tools');
      const toolsData = await toolsRes.json();
      setMcpTools(toolsData.tools || []);
      
    } catch (err) {
      setConnectionStatus({
        success: false,
        message: err.message,
        serverName: serverName
      });
    } finally {
      setMcpTesting(false);
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
            title={c.name} // Show full name on hover
          >
            {c.name}
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
        {mcpEnabled && mcpTools.length > 0 && (
          <div className="mcp-tools-panel">
            <span className="mcp-tools-label">🔧 MCP Tools Available ({mcpTools.length}):</span>
            {mcpTools.map((tool, idx) => (
              <span key={idx} className="mcp-tool">{tool.function.name}</span>
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
                  dangerouslySetInnerHTML={{ __html: addCopyButtons(marked.parse(m.text)) }}
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
                      dangerouslySetInnerHTML={{ __html: addCopyButtons(marked.parse(m.think)) }}
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
              <div className="modal-header">
                <h2>MCP Server Configuration</h2>
                <button 
                  className="close-button"
                  onClick={() => { 
                    setMcpModalOpen(false); 
                    setMcpJson(''); 
                    setEditing(null); 
                    setMcpError(''); 
                    setConnectionStatus(null);
                  }}
                  title="Close"
                >
                  ✕
                </button>
              </div>
              <div className="mcp-toggle-section">
                <label className="mcp-toggle-label">
                  <input
                    type="checkbox"
                    checked={mcpEnabled}
                    onChange={(e) => setMcpEnabled(e.target.checked)}
                    className="mcp-toggle-checkbox"
                  />
                  <span className="mcp-toggle-text">Enable MCP Tools</span>
                </label>
              </div>
              <div className="server-list">
                {mcpServers.map((s) => (
                  <div key={s.name} className="server-item">
                    <div className="server-info">
                      <span className="server-name">{s.name}</span>
                      {s.connectionStatus && (
                        <span className={`connection-status ${s.connectionStatus}`}>
                          {s.connectionStatus === 'connected' ? '🟢' : '🔴'} 
                          {s.connectionStatus}
                        </span>
                      )}
                      {s.connectionMessage && (
                        <span className="connection-message">{s.connectionMessage}</span>
                      )}
                    </div>
                    <div className="server-actions">
                      <button 
                        onClick={() => testMcpServer(s.name)}
                        disabled={mcpTesting}
                        className="test-button"
                      >
                        {mcpTesting ? '⏳' : '🔄'} Test
                      </button>
                      <button onClick={() => startEdit(s)}>Edit</button>
                      <button onClick={() => deleteMcpServer(s.name)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
              <textarea
                ref={editorRef}
                defaultValue={mcpJson}
                onChange={handleMcpJsonChange}
                placeholder='Examples:

Full Claude Desktop format:
{
  "mcpServers": {
    "salesforce": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8000/mcp"
      ]
    }
  }
}

Single server format:
{
  "my-server": {
    "url": "http://localhost:3000/mcp"
  }
}

Legacy format:
{
  "name": "my-server",
  "url": "http://localhost:3000/mcp"
}'
              />
              {mcpError && <div className="error">{mcpError}</div>}
              {connectionStatus && (
                <div className={`connection-feedback ${connectionStatus.success ? 'success' : 'error'}`}>
                  {connectionStatus.success ? '✅' : '❌'} 
                  <span className="status-message">
                    {connectionStatus.serverName}: {connectionStatus.message}
                  </span>
                </div>
              )}
              <div className="modal-buttons">
                <button 
                  onClick={addMcpServer}
                  disabled={mcpTesting}
                >
                  {mcpTesting ? '⏳ Testing...' : (editing ? 'Save Changes' : 'Add Server')}
                </button>
                <button onClick={() => { 
                  setMcpModalOpen(false); 
                  setMcpJson(''); 
                  setEditing(null); 
                  setMcpError(''); 
                  setConnectionStatus(null);
                }}>Cancel</button>
                {connectionStatus && !connectionStatus.success && (
                  <button 
                    onClick={() => {
                      setMcpModalOpen(false);
                      setMcpJson('');
                      setEditing(null);
                      setMcpError('');
                      setConnectionStatus(null);
                    }}
                    className="save-anyway-button"
                  >
                    Save Anyway
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </React.Fragment>
  );
}

ReactDOM.render(<ChatApp />, document.getElementById('root'));
