/**
 * Core MCP (Model Context Protocol) Implementation
 * Implements JSON-RPC 2.0 communication protocol for MCP servers
 */

class MCPCore {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 30000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      batchSize: options.batchSize || 10,
      ...options
    };
    
    this.servers = new Map();
    this.toolCache = new Map();
    this.requestQueue = [];
    this.batchProcessor = null;
    this.healthMonitor = null;
    
    this.initializeBatchProcessor();
    this.initializeHealthMonitor();
  }

  /**
   * Register an MCP server
   */
  async registerServer(name, config) {
    const server = new MCPServer(name, config, this.options);
    await server.initialize();
    this.servers.set(name, server);
    
    // Discover and cache tools
    await this.discoverTools(name);
    
    return server;
  }

  /**
   * Unregister an MCP server
   */
  async unregisterServer(name) {
    const server = this.servers.get(name);
    if (server) {
      await server.disconnect();
      this.servers.delete(name);
      this.toolCache.delete(name);
    }
  }

  /**
   * Discover tools from a server
   */
  async discoverTools(serverName) {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`Server ${serverName} not found`);

    try {
      const tools = await server.listTools();
      this.toolCache.set(serverName, {
        tools,
        timestamp: Date.now(),
        capabilities: await server.getCapabilities()
      });
      return tools;
    } catch (error) {
      console.error(`Failed to discover tools for ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Get all available tools from all servers
   */
  getAllTools() {
    const allTools = [];
    for (const [serverName, cache] of this.toolCache) {
      const server = this.servers.get(serverName);
      if (server && server.isHealthy()) {
        cache.tools.forEach(tool => {
          allTools.push({
            ...tool,
            serverName,
            fullName: `${serverName}_${tool.name}`
          });
        });
      }
    }
    return allTools;
  }

  /**
   * Execute a tool call
   */
  async callTool(toolName, parameters, options = {}) {
    const parts = toolName.split('_');
    const serverName = parts[0];
    const actualToolName = parts.slice(1).join('_');

    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server ${serverName} not found`);
    }

    if (!server.isHealthy()) {
      throw new Error(`Server ${serverName} is not healthy`);
    }

    try {
      const result = await server.callTool(actualToolName, parameters, options);
      return {
        success: true,
        result: result.result || result,
        serverName,
        toolName,
        metadata: result.metadata || {}
      };
    } catch (error) {
      console.error(`Tool execution failed for ${toolName}:`, error);
      return {
        success: false,
        error: error.message,
        serverName,
        toolName
      };
    }
  }

  /**
   * Execute multiple tool calls in batch
   */
  async batchCallTools(calls) {
    const results = [];
    const batches = [];
    
    // Group calls by server for optimal batching
    const serverGroups = new Map();
    calls.forEach((call, index) => {
      const serverName = call.toolName.split('_')[0];
      if (!serverGroups.has(serverName)) {
        serverGroups.set(serverName, []);
      }
      serverGroups.get(serverName).push({ ...call, originalIndex: index });
    });

    // Process each server group
    for (const [serverName, serverCalls] of serverGroups) {
      const server = this.servers.get(serverName);
      if (!server || !server.isHealthy()) {
        serverCalls.forEach(call => {
          results[call.originalIndex] = {
            success: false,
            error: `Server ${serverName} not available`,
            toolName: call.toolName
          };
        });
        continue;
      }

      // Create batches of calls
      for (let i = 0; i < serverCalls.length; i += this.options.batchSize) {
        const batch = serverCalls.slice(i, i + this.options.batchSize);
        batches.push(this.processBatch(server, batch));
      }
    }

    // Execute all batches
    const batchResults = await Promise.allSettled(batches);
    
    // Flatten results maintaining original order
    batchResults.forEach(batchResult => {
      if (batchResult.status === 'fulfilled') {
        batchResult.value.forEach(result => {
          results[result.originalIndex] = result;
        });
      } else {
        console.error('Batch execution failed:', batchResult.reason);
      }
    });

    return results.filter(r => r !== undefined);
  }

  /**
   * Process a batch of tool calls for a single server
   */
  async processBatch(server, calls) {
    const promises = calls.map(async call => {
      try {
        const result = await this.callTool(call.toolName, call.parameters, call.options);
        return { ...result, originalIndex: call.originalIndex };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          toolName: call.toolName,
          originalIndex: call.originalIndex
        };
      }
    });

    return await Promise.allSettled(promises).then(results =>
      results.map(r => r.status === 'fulfilled' ? r.value : {
        success: false,
        error: 'Batch processing failed',
        originalIndex: -1
      })
    );
  }

  /**
   * Initialize batch processor for queued requests
   */
  initializeBatchProcessor() {
    this.batchProcessor = setInterval(() => {
      if (this.requestQueue.length > 0) {
        const batch = this.requestQueue.splice(0, this.options.batchSize);
        this.processBatch(null, batch).catch(console.error);
      }
    }, 100);
  }

  /**
   * Initialize health monitoring
   */
  initializeHealthMonitor() {
    this.healthMonitor = setInterval(async () => {
      for (const [name, server] of this.servers) {
        try {
          await server.healthCheck();
        } catch (error) {
          console.error(`Health check failed for ${name}:`, error);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get server statistics
   */
  getStats() {
    const stats = {
      totalServers: this.servers.size,
      healthyServers: 0,
      totalTools: 0,
      cacheStats: {},
      serverStats: {}
    };

    for (const [name, server] of this.servers) {
      const isHealthy = server.isHealthy();
      if (isHealthy) stats.healthyServers++;

      const cache = this.toolCache.get(name);
      if (cache) {
        stats.totalTools += cache.tools.length;
        stats.cacheStats[name] = {
          toolCount: cache.tools.length,
          lastUpdated: cache.timestamp,
          age: Date.now() - cache.timestamp
        };
      }

      stats.serverStats[name] = {
        isHealthy,
        config: server.getConfig(),
        connectionType: server.getConnectionType(),
        lastHealthCheck: server.getLastHealthCheck()
      };
    }

    return stats;
  }

  /**
   * Cleanup resources
   */
  async shutdown() {
    if (this.batchProcessor) {
      clearInterval(this.batchProcessor);
    }
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
    }

    // Disconnect all servers
    const disconnectPromises = Array.from(this.servers.values()).map(server => 
      server.disconnect().catch(console.error)
    );
    
    await Promise.allSettled(disconnectPromises);
    
    this.servers.clear();
    this.toolCache.clear();
    this.requestQueue = [];
  }
}

/**
 * Individual MCP Server implementation
 */
class MCPServer {
  constructor(name, config, options = {}) {
    this.name = name;
    this.config = config;
    this.options = options;
    this.isConnected = false;
    this.lastHealthCheck = null;
    this.capabilities = null;
    this.connectionType = this.determineConnectionType();
    this.retryCount = 0;
  }

  determineConnectionType() {
    if (this.config.url) return 'http';
    if (this.config.command) return 'subprocess';
    if (this.config.stdio) return 'stdio';
    return 'unknown';
  }

  async initialize() {
    switch (this.connectionType) {
      case 'http':
        await this.initializeHttpConnection();
        break;
      case 'subprocess':
        await this.initializeSubprocessConnection();
        break;
      default:
        throw new Error(`Unsupported connection type: ${this.connectionType}`);
    }

    this.isConnected = true;
    await this.negotiateCapabilities();
  }

  async initializeHttpConnection() {
    // HTTP connection is stateless, just verify the endpoint
    try {
      const response = await this.makeHttpRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
          sampling: {}
        },
        clientInfo: {
          name: 'mcp-web-client',
          version: '1.0.0'
        }
      });

      if (response.error) {
        throw new Error(`Initialize failed: ${response.error.message}`);
      }

      this.capabilities = response.result?.capabilities || {};
    } catch (error) {
      console.error(`HTTP initialization failed for ${this.name}:`, error);
      throw error;
    }
  }

  async initializeSubprocessConnection() {
    // For subprocess connections, we'll implement stdio communication
    throw new Error('Subprocess connections not yet implemented');
  }

  async makeHttpRequest(method, params = {}, options = {}) {
    const url = this.config.url;
    const timeout = options.timeout || this.options.timeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...this.config.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now() + Math.random(),
          method: method,
          params: params
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        return await this.parseSSEResponse(response);
      } else {
        return await response.json();
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  async parseSSEResponse(response) {
    const text = await response.text();
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const dataStr = line.substring(6).trim();
          if (dataStr && dataStr !== '[DONE]') {
            return JSON.parse(dataStr);
          }
        } catch (parseErr) {
          continue;
        }
      }
    }
    
    throw new Error('No valid JSON found in SSE response');
  }

  async negotiateCapabilities() {
    // Capability negotiation is already done in initialize
    // This method can be extended for more complex negotiation
  }

  async listTools() {
    const response = await this.makeHttpRequest('tools/list');
    if (response.error) {
      throw new Error(`List tools failed: ${response.error.message}`);
    }
    return response.result?.tools || [];
  }

  async callTool(toolName, parameters, options = {}) {
    const response = await this.makeHttpRequest('tools/call', {
      name: toolName,
      arguments: parameters
    }, options);

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.result || response;
  }

  async getCapabilities() {
    return this.capabilities || {};
  }

  async healthCheck() {
    try {
      // Simple ping to check if server is responsive
      const response = await this.makeHttpRequest('ping', {}, { timeout: 5000 });
      this.lastHealthCheck = Date.now();
      this.retryCount = 0;
      return true;
    } catch (error) {
      this.retryCount++;
      console.error(`Health check failed for ${this.name} (attempt ${this.retryCount}):`, error);
      
      if (this.retryCount >= this.options.retryAttempts) {
        this.isConnected = false;
      }
      
      return false;
    }
  }

  isHealthy() {
    const maxAge = 60000; // 1 minute
    return this.isConnected && 
           this.lastHealthCheck && 
           (Date.now() - this.lastHealthCheck) < maxAge;
  }

  getConfig() {
    return { ...this.config };
  }

  getConnectionType() {
    return this.connectionType;
  }

  getLastHealthCheck() {
    return this.lastHealthCheck;
  }

  async disconnect() {
    this.isConnected = false;
    // HTTP connections don't need explicit disconnection
    // Subprocess connections would need cleanup here
  }
}

module.exports = { MCPCore, MCPServer };