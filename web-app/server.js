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

// Function to communicate with MCP server
async function communicateWithMcpServer(server, method, params = {}) {
  if (server.command === 'npx' && server.args && server.args[0] === 'mcp-remote') {
    // Handle mcp-remote pattern
    const mcpUrl = server.args[1];
    
    try {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: method,
          params: params
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`MCP communication error: ${err.message}`);
      throw err;
    }
  } else {
    throw new Error('Unsupported MCP server configuration');
  }
}

// New endpoint to get MCP tools for enabled servers
app.get('/api/mcp-tools', async (req, res) => {
  try {
    const cfg = readConfig();
    const enabledServers = Object.entries(cfg.mcpServers || {})
      .filter(([name, server]) => server.enabled && server.connectionStatus === 'connected');
    
    const tools = [];
    
    for (const [serverName, server] of enabledServers) {
      try {
        // Query the MCP server for available tools
        const toolsResponse = await communicateWithMcpServer(server, 'tools/list');
        
        if (toolsResponse.result && toolsResponse.result.tools) {
          toolsResponse.result.tools.forEach(tool => {
            tools.push({
              type: "function",
              function: {
                name: `${serverName}_${tool.name}`,
                description: tool.description || `Tool ${tool.name} from ${serverName} MCP server`,
                parameters: tool.inputSchema || {
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
          // Fallback: try to discover resources if tools not available
          try {
            const resourcesResponse = await communicateWithMcpServer(server, 'resources/list');
            if (resourcesResponse.result && resourcesResponse.result.resources) {
              // Create a generic tool for resource access
              tools.push({
                type: "function",
                function: {
                  name: `${serverName}_get_resource`,
                  description: `Access resources from ${serverName} MCP server`,
                  parameters: {
                    type: "object",
                    properties: {
                      uri: {
                        type: "string",
                        description: "The resource URI to access"
                      }
                    },
                    required: ["uri"]
                  }
                }
              });
            }
          } catch (resourceErr) {
            console.log(`No resources available from ${serverName}`);
          }
          
          // If no tools or resources, create a default tool
          if (tools.filter(t => t.function.name.startsWith(serverName)).length === 0) {
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
                    arguments: {
                      type: "object",
                      description: "Arguments for the action"
                    }
                  },
                  required: ["action"]
                }
              }
            });
          }
        }
      } catch (err) {
        console.error(`Error getting tools from ${serverName}:`, err);
        // Add a fallback tool even if discovery fails
        tools.push({
          type: "function",
          function: {
            name: `${serverName}_execute`,
            description: `Execute action using ${serverName} MCP server (discovery failed)`,
            parameters: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  description: "The action to perform"
                },
                arguments: {
                  type: "object",
                  description: "Arguments for the action"
                }
              },
              required: ["action"]
            }
          }
        });
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
    
    // Extract server name and actual tool name
    const parts = toolName.split('_');
    const serverName = parts[0];
    const actualToolName = parts.slice(1).join('_');
    
    const cfg = readConfig();
    const server = cfg.mcpServers[serverName];
    
    if (!server || !server.enabled) {
      return res.status(404).json({ error: 'Server not found or disabled' });
    }
    
    try {
      let mcpResponse;
      
      if (actualToolName === 'get_resource') {
        // Handle resource access
        mcpResponse = await communicateWithMcpServer(server, 'resources/read', {
          uri: parameters.uri
        });
      } else if (actualToolName === 'execute') {
        // Handle generic execute calls - try to call the action as a tool
        mcpResponse = await communicateWithMcpServer(server, 'tools/call', {
          name: parameters.action,
          arguments: parameters.arguments || {}
        });
      } else {
        // Handle specific tool calls
        mcpResponse = await communicateWithMcpServer(server, 'tools/call', {
          name: actualToolName,
          arguments: parameters
        });
      }
      
      const result = {
        success: true,
        result: mcpResponse.result || mcpResponse,
        serverName: serverName,
        toolName: toolName
      };
      
      res.json(result);
    } catch (mcpErr) {
      console.error(`MCP execution error for ${toolName}:`, mcpErr);
      res.json({
        success: false,
        error: `MCP execution failed: ${mcpErr.message}`,
        serverName: serverName,
        toolName: toolName
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint to test MCP server communication
app.post('/api/debug-mcp', async (req, res) => {
  try {
    const { url, method, params } = req.body;
    
    console.log(`Testing MCP call: ${method} to ${url}`);
    console.log('Params:', params);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: method,
        params: params || {}
      })
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Response body:', responseText);
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseErr) {
      responseData = { raw: responseText };
    }
    
    res.json({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data: responseData,
      raw: responseText
    });
    
  } catch (err) {
    console.error('Debug MCP error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
