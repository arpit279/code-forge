const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

const app = express();
app.use(express.json());

const CONFIG_PATH = path.join(__dirname, '..', 'mcp-config.json');
const PORT = 3000;

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mcpServers: {} }, null, 2));
  }
  const data = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(data);
  
  // Convert old format to new format if needed
  if (config.servers) {
    config.mcpServers = {};
    config.servers.forEach(server => {
      const name = server.name;
      delete server.name;
      config.mcpServers[name] = server;
    });
    delete config.servers;
    writeConfigDirect(config);
  }
  
  return config;
}

function writeConfigDirect(cfg) {
  const backup = CONFIG_PATH + '.bak';
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, backup);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function writeConfig(cfg) {
  writeConfigDirect(cfg);
}

async function testMcpConnection(server) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    // Test URL-based connection
    if (server.url) {
      const url = new URL(server.url);
      const client = url.protocol === 'https:' ? https : http;
      
      const req = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname || '/',
        method: 'GET',
        timeout: 4000
      }, (res) => {
        clearTimeout(timeout);
        resolve({ 
          success: true, 
          status: res.statusCode,
          message: `Connected to ${server.url}` 
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ 
          success: false, 
          error: `Connection failed: ${err.message}` 
        });
      });

      req.end();
    }
    // Test command-based connection
    else if (server.command) {
      try {
        // Special handling for mcp-remote pattern
        if (server.command === 'npx' && server.args && server.args[0] === 'mcp-remote') {
          // Extract URL from mcp-remote args and test it
          const mcpUrl = server.args[1];
          if (mcpUrl && mcpUrl.startsWith('http')) {
            try {
              const url = new URL(mcpUrl);
              const client = url.protocol === 'https:' ? https : http;
              
              const req = client.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname || '/',
                method: 'GET',
                timeout: 4000
              }, (res) => {
                clearTimeout(timeout);
                resolve({ 
                  success: true, 
                  message: `MCP remote server accessible at ${mcpUrl}` 
                });
              });

              req.on('error', (err) => {
                clearTimeout(timeout);
                resolve({ 
                  success: false, 
                  error: `MCP remote server failed: ${err.message}` 
                });
              });

              req.end();
              return;
            } catch (urlErr) {
              clearTimeout(timeout);
              resolve({ 
                success: false, 
                error: `Invalid URL in mcp-remote args: ${mcpUrl}` 
              });
              return;
            }
          }
        }
        
        // General command testing
        const child = spawn(server.command, server.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 3000
        });

        child.on('spawn', () => {
          clearTimeout(timeout);
          child.kill();
          resolve({ 
            success: true, 
            message: `Command executable: ${server.command} ${(server.args || []).join(' ')}` 
          });
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ 
            success: false, 
            error: `Command failed: ${err.message}` 
          });
        });
      } catch (err) {
        clearTimeout(timeout);
        resolve({ 
          success: false, 
          error: `Command error: ${err.message}` 
        });
      }
    }
    else {
      clearTimeout(timeout);
      resolve({ 
        success: false, 
        error: 'No URL or command specified' 
      });
    }
  });
}

function validateMcpServer(serverName, server) {
  const errors = [];
  
  if (!serverName || typeof serverName !== 'string') {
    errors.push('Server name is required');
  }
  
  if (!server.url && !server.command) {
    errors.push('Either URL or command must be specified');
  }
  
  if (server.url && !server.url.startsWith('http')) {
    errors.push('URL must start with http:// or https://');
  }
  
  if (server.command) {
    // Special handling for npx and common commands
    const validCommands = ['npx', 'node', 'python', 'python3', 'uvx'];
    const isValidCommand = validCommands.includes(server.command) || fs.existsSync(server.command);
    
    if (!isValidCommand) {
      errors.push(`Command '${server.command}' not found. For npx commands, ensure npm is installed.`);
    }
    
    // Validate args array if present
    if (server.args && !Array.isArray(server.args)) {
      errors.push('Args must be an array');
    }
  }
  
  if (server.enabled !== undefined && typeof server.enabled !== 'boolean') {
    errors.push('Enabled must be a boolean');
  }
  
  return errors;
}

app.get('/api/mcp-config', (req, res) => {
  try {
    const config = readConfig();
    // Convert to array format for frontend compatibility
    const servers = Object.entries(config.mcpServers || {}).map(([name, server]) => ({
      name,
      ...server
    }));
    res.json({ servers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mcp-config', async (req, res) => {
  try {
    const cfg = readConfig();
    const requestData = req.body;
    
    // Handle multiple formats
    let serverName, server;
    
    if (requestData.mcpServers) {
      // Full Claude Desktop format: {"mcpServers": {"serverName": {...config}}}
      const serverKeys = Object.keys(requestData.mcpServers);
      if (serverKeys.length !== 1) {
        return res.status(400).json({ 
          error: 'Expected exactly one server in mcpServers object' 
        });
      }
      serverName = serverKeys[0];
      server = requestData.mcpServers[serverName];
    } else if (requestData.name) {
      // Legacy format: {name: "serverName", url: "...", ...}
      serverName = requestData.name;
      server = { ...requestData };
      delete server.name;
    } else {
      // Single server format: {"serverName": {url: "...", ...}}
      const keys = Object.keys(requestData);
      if (keys.length !== 1) {
        return res.status(400).json({ 
          error: 'Invalid format. Expected Claude Desktop format with mcpServers object' 
        });
      }
      serverName = keys[0];
      server = requestData[serverName];
    }
    
    // Validate server configuration
    const validationErrors = validateMcpServer(serverName, server);
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors 
      });
    }
    
    // Test connection to MCP server
    const connectionTest = await testMcpConnection(server);
    
    // Add connection status to server object
    server.connectionStatus = connectionTest.success ? 'connected' : 'failed';
    server.connectionMessage = connectionTest.message || connectionTest.error;
    server.lastTested = new Date().toISOString();
    
    // Set enabled status based on connection test if not explicitly set
    if (server.enabled === undefined) {
      server.enabled = connectionTest.success;
    }
    
    // Store in Claude Desktop format
    if (!cfg.mcpServers) {
      cfg.mcpServers = {};
    }
    cfg.mcpServers[serverName] = server;
    
    writeConfig(cfg);
    
    // Convert back to array format for response
    const servers = Object.entries(cfg.mcpServers).map(([name, srv]) => ({
      name,
      ...srv
    }));
    
    // Return config with connection test results
    res.json({
      servers,
      connectionTest: connectionTest
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mcp-config/:name/test', async (req, res) => {
  try {
    const cfg = readConfig();
    const serverName = req.params.name;
    const server = cfg.mcpServers[serverName];
    
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    const connectionTest = await testMcpConnection(server);
    
    // Update server status
    server.connectionStatus = connectionTest.success ? 'connected' : 'failed';
    server.connectionMessage = connectionTest.message || connectionTest.error;
    server.lastTested = new Date().toISOString();
    
    writeConfig(cfg);
    
    res.json({
      server: { name: serverName, ...server },
      connectionTest: connectionTest
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mcp-config/:name', (req, res) => {
  try {
    const cfg = readConfig();
    const serverName = req.params.name;
    
    if (cfg.mcpServers && cfg.mcpServers[serverName]) {
      delete cfg.mcpServers[serverName];
      writeConfig(cfg);
    }
    
    // Convert to array format for response
    const servers = Object.entries(cfg.mcpServers || {}).map(([name, server]) => ({
      name,
      ...server
    }));
    
    res.json({ servers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New endpoint to get MCP tools for enabled servers
app.get('/api/mcp-tools', async (req, res) => {
  try {
    const cfg = readConfig();
    const enabledServers = Object.entries(cfg.mcpServers || {})
      .filter(([name, server]) => server.enabled && server.connectionStatus === 'connected');
    
    const tools = [];
    
    for (const [serverName, server] of enabledServers) {
      try {
        // For now, we'll use a simplified tool discovery
        // In a full implementation, you'd query the MCP server for available tools
        if (server.tools && Array.isArray(server.tools)) {
          server.tools.forEach(tool => {
            tools.push({
              type: "function",
              function: {
                name: `${serverName}_${typeof tool === 'string' ? tool : tool.name}`,
                description: `Tool from ${serverName} MCP server: ${typeof tool === 'string' ? tool : tool.description || tool.name}`,
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "The query or action to perform"
                    }
                  },
                  required: ["query"]
                }
              }
            });
          });
        } else {
          // Default tool if no specific tools are defined
          tools.push({
            type: "function",
            function: {
              name: `${serverName}_execute`,
              description: `Execute action using ${serverName} MCP server`,
              parameters: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    description: "The action to perform"
                  },
                  query: {
                    type: "string", 
                    description: "The query or parameters for the action"
                  }
                },
                required: ["action"]
              }
            }
          });
        }
      } catch (err) {
        console.error(`Error getting tools from ${serverName}:`, err);
      }
    }
    
    res.json({ tools });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New endpoint to execute MCP tool calls
app.post('/api/mcp-execute', async (req, res) => {
  try {
    const { toolName, parameters } = req.body;
    
    // Extract server name from tool name
    const serverName = toolName.split('_')[0];
    const cfg = readConfig();
    const server = cfg.mcpServers[serverName];
    
    if (!server || !server.enabled) {
      return res.status(404).json({ error: 'Server not found or disabled' });
    }
    
    // For now, return a mock response
    // In a full implementation, you'd call the actual MCP server
    const result = {
      success: true,
      result: `Executed ${toolName} with parameters: ${JSON.stringify(parameters)}`,
      serverName: serverName,
      toolName: toolName
    };
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
