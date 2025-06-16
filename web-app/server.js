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
        const child = spawn(server.command, server.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 3000
        });

        child.on('spawn', () => {
          clearTimeout(timeout);
          child.kill();
          resolve({ 
            success: true, 
            message: `Command executable: ${server.command}` 
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
  
  if (server.command && !fs.existsSync(server.command)) {
    errors.push('Command path does not exist');
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
    
    // Handle both formats: {name: "...", ...config} or {"serverName": {...config}}
    let serverName, server;
    
    if (requestData.name) {
      // Old format: {name: "serverName", url: "...", ...}
      serverName = requestData.name;
      server = { ...requestData };
      delete server.name;
    } else {
      // New Claude Desktop format: {"serverName": {url: "...", ...}}
      const keys = Object.keys(requestData);
      if (keys.length !== 1) {
        return res.status(400).json({ 
          error: 'Invalid format. Expected either {name: "...", ...config} or {"serverName": {...config}}' 
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

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
