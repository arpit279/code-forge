/**
 * Integrated MCP System
 * Orchestrates all MCP components for sophisticated tool integration
 */

const { MCPCore } = require('./mcp-core');
const { NLPProcessor } = require('./nlp-processor');
const { ToolManager } = require('./tool-manager');
const { ResponseProcessor } = require('./response-processor');
const { ErrorHandler } = require('./error-handler');
const EventEmitter = require('events');
const crypto = require('crypto');

class MCPSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enableNLP: options.enableNLP !== false,
      enableCaching: options.enableCaching !== false,
      enableBatching: options.enableBatching !== false,
      maxConcurrentRequests: options.maxConcurrentRequests || 5,
      requestTimeout: options.requestTimeout || 30000,
      ...options
    };

    // Initialize components
    this.mcpCore = new MCPCore(this.options);
    this.nlpProcessor = new NLPProcessor(this.options.nlp || {});
    this.toolManager = new ToolManager(this.options.toolManager || {});
    this.responseProcessor = new ResponseProcessor(this.options.responseProcessor || {});
    this.errorHandler = new ErrorHandler(this.options.errorHandler || {});

    // State management
    this.sessions = new Map();
    this.requestQueue = [];
    this.activeRequests = new Map();
    this.globalCache = new Map();
    
    this.setupEventHandlers();
    this.initializeSystem();
  }

  /**
   * Initialize the MCP system
   */
  async initializeSystem() {
    try {
      this.emit('systemInitializing');
      
      // Load existing server configurations
      await this.loadServerConfigurations();
      
      this.emit('systemInitialized');
    } catch (error) {
      this.emit('systemError', error);
      throw error;
    }
  }

  /**
   * Register a new MCP server
   */
  async registerServer(name, config, options = {}) {
    try {
      const operationId = `register_server_${name}`;
      
      const server = await this.errorHandler.executeWithRetry(
        () => this.mcpCore.registerServer(name, config),
        operationId,
        { timeout: this.options.requestTimeout }
      );

      // Discover and register tools
      const tools = await this.errorHandler.executeWithRetry(
        () => this.mcpCore.discoverTools(name),
        `discover_tools_${name}`,
        { timeout: this.options.requestTimeout }
      );

      // Register tools with tool manager
      for (const tool of tools) {
        await this.toolManager.registerTool(tool, name, options.toolOptions || {});
      }

      this.emit('serverRegistered', { name, server, tools });
      return { server, tools };

    } catch (error) {
      this.emit('serverRegistrationFailed', { name, error });
      throw error;
    }
  }

  /**
   * Process natural language input and execute appropriate tools
   */
  async processInput(input, sessionId = 'default', options = {}) {
    const requestId = this.generateRequestId();
    
    try {
      this.emit('inputProcessing', { requestId, input, sessionId });

      // Get session context
      const session = this.getOrCreateSession(sessionId);
      
      // Check cache first
      if (this.options.enableCaching) {
        const cacheKey = this.generateCacheKey(input, session.context);
        const cached = this.globalCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes
          this.emit('cacheHit', { requestId, cacheKey });
          return cached.response;
        }
      }

      // Process with NLP if enabled
      let toolSuggestions = [];
      let nlpResults = null;

      if (this.options.enableNLP) {
        const availableTools = this.toolManager.getTools({ enabled: true });
        
        nlpResults = await this.errorHandler.executeWithRetry(
          () => this.nlpProcessor.processInput(input, sessionId, availableTools),
          `nlp_process_${requestId}`,
          { timeout: 10000 }
        );

        // Check for disambiguation
        const disambiguation = this.nlpProcessor.disambiguate(nlpResults);
        if (disambiguation && disambiguation.needsDisambiguation) {
          return {
            success: true,
            needsDisambiguation: true,
            disambiguation: disambiguation.questions,
            originalResults: nlpResults
          };
        }

        toolSuggestions = nlpResults.toolSuggestions;
      } else {
        // Fallback: simple keyword matching
        toolSuggestions = this.simpleToolMatching(input);
      }

      // Execute tool calls
      const toolResults = await this.executeToolCalls(toolSuggestions, requestId, options);

      // Process responses
      const finalResponse = await this.responseProcessor.processToolResponses(
        toolResults,
        {
          input,
          sessionId,
          inputHash: this.generateCacheKey(input, session.context),
          nlpResults
        }
      );

      // Update session context
      this.updateSessionContext(sessionId, {
        input,
        nlpResults,
        toolResults,
        response: finalResponse,
        timestamp: Date.now()
      });

      // Cache response
      if (this.options.enableCaching && finalResponse.success) {
        const cacheKey = this.generateCacheKey(input, session.context);
        this.globalCache.set(cacheKey, {
          response: finalResponse,
          timestamp: Date.now()
        });
      }

      this.emit('inputProcessed', { requestId, input, response: finalResponse });
      return finalResponse;

    } catch (error) {
      this.emit('inputProcessingFailed', { requestId, input, error });
      
      return {
        success: false,
        error: error.message,
        content: 'I encountered an error while processing your request. Please try again.',
        metadata: {
          requestId,
          error: error.message,
          timestamp: Date.now()
        }
      };
    }
  }

  /**
   * Execute tool calls with batching and concurrency control
   */
  async executeToolCalls(toolSuggestions, requestId, options = {}) {
    if (!toolSuggestions || toolSuggestions.length === 0) {
      return [];
    }

    const results = [];
    const calls = [];

    // Prepare tool calls
    for (const suggestion of toolSuggestions) {
      const toolCall = {
        toolName: suggestion.tool.fullName || `${suggestion.tool.serverName}_${suggestion.tool.name}`,
        parameters: suggestion.parameters || {},
        options: {
          timeout: options.toolTimeout || this.options.requestTimeout,
          ...options
        }
      };

      calls.push(toolCall);
    }

    // Execute with batching if enabled
    if (this.options.enableBatching && calls.length > 1) {
      const batchResults = await this.errorHandler.executeWithRetry(
        () => this.mcpCore.batchCallTools(calls),
        `batch_tools_${requestId}`,
        { timeout: this.options.requestTimeout * 2 }
      );
      results.push(...batchResults);
    } else {
      // Execute sequentially or with limited concurrency
      const semaphore = new Semaphore(this.options.maxConcurrentRequests);
      
      const promises = calls.map(call => 
        semaphore.acquire().then(async (release) => {
          try {
            const result = await this.errorHandler.executeWithRetry(
              () => this.mcpCore.callTool(call.toolName, call.parameters, call.options),
              `tool_call_${call.toolName}_${requestId}`,
              { timeout: call.options.timeout }
            );
            return result;
          } finally {
            release();
          }
        })
      );

      const toolResults = await Promise.allSettled(promises);
      
      for (const result of toolResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason.message,
            toolName: 'unknown'
          });
        }
      }
    }

    return results;
  }

  /**
   * Simple tool matching fallback when NLP is disabled
   */
  simpleToolMatching(input) {
    const tools = this.toolManager.getTools({ enabled: true });
    const suggestions = [];
    
    const inputLower = input.toLowerCase();
    
    for (const tool of tools) {
      let score = 0;
      
      // Check tool name
      if (inputLower.includes(tool.name.toLowerCase())) {
        score += 0.8;
      }
      
      // Check description
      if (tool.description && inputLower.includes(tool.description.toLowerCase())) {
        score += 0.6;
      }
      
      // Check tags
      if (tool.tags) {
        for (const tag of tool.tags) {
          if (inputLower.includes(tag.toLowerCase())) {
            score += 0.4;
          }
        }
      }
      
      if (score > 0) {
        suggestions.push({
          tool,
          score,
          parameters: {},
          confidence: Math.min(score, 1.0)
        });
      }
    }

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  /**
   * Get or create session
   */
  getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        context: [],
        preferences: {},
        stats: {
          requestCount: 0,
          successCount: 0,
          errorCount: 0
        }
      });
    }

    const session = this.sessions.get(sessionId);
    session.lastActivity = Date.now();
    session.stats.requestCount++;
    
    return session;
  }

  /**
   * Update session context
   */
  updateSessionContext(sessionId, entry) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.context.push(entry);
      
      // Keep only recent context
      if (session.context.length > 10) {
        session.context = session.context.slice(-10);
      }

      if (entry.response && entry.response.success) {
        session.stats.successCount++;
      } else if (entry.response) {
        session.stats.errorCount++;
      }
    }
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate cache key
   */
  generateCacheKey(input, context = []) {
    const contextStr = context.slice(-3).map(c => c.input || '').join('|');
    const content = `${input}|${contextStr}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Get system statistics
   */
  getSystemStats() {
    const mcpStats = this.mcpCore.getStats();
    const toolStats = this.toolManager.getSystemStats();
    const errorStats = this.errorHandler.getErrorStats();

    return {
      mcp: mcpStats,
      tools: toolStats,
      errors: errorStats,
      sessions: {
        total: this.sessions.size,
        active: Array.from(this.sessions.values()).filter(s => 
          Date.now() - s.lastActivity < 300000
        ).length
      },
      cache: {
        size: this.globalCache.size,
        hitRate: this.calculateCacheHitRate()
      },
      system: {
        uptime: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage(),
        version: '1.0.0'
      }
    };
  }

  /**
   * Calculate cache hit rate
   */
  calculateCacheHitRate() {
    // This would need to be tracked separately in a real implementation
    return 0;
  }

  /**
   * Load server configurations
   */
  async loadServerConfigurations() {
    // This would load from persistent storage
    // For now, just emit that it's done
    this.emit('serverConfigurationsLoaded');
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Handle tool manager events
    this.toolManager.on('toolRegistered', (tool) => {
      this.emit('toolRegistered', tool);
    });

    this.toolManager.on('toolUsed', (data) => {
      this.emit('toolUsed', data);
    });

    // Handle error events
    this.errorHandler.on('circuitBreakerOpened', (data) => {
      this.emit('circuitBreakerOpened', data);
    });

    // Handle response processor events
    this.responseProcessor.on('responseProcessed', (response) => {
      this.emit('responseProcessed', response);
    });

    this.startTime = Date.now();
  }

  /**
   * Clean up expired sessions and cache
   */
  cleanup() {
    const now = Date.now();
    const sessionTimeout = 3600000; // 1 hour
    const cacheTimeout = 1800000; // 30 minutes

    // Clean up sessions
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > sessionTimeout) {
        this.sessions.delete(sessionId);
      }
    }

    // Clean up cache
    for (const [key, entry] of this.globalCache) {
      if (now - entry.timestamp > cacheTimeout) {
        this.globalCache.delete(key);
      }
    }
  }

  /**
   * Shutdown the system
   */
  async shutdown() {
    this.emit('systemShutdown');
    
    // Stop all components
    await Promise.allSettled([
      this.mcpCore.shutdown(),
      this.toolManager.shutdown(),
      this.responseProcessor.shutdown(),
      this.errorHandler.shutdown()
    ]);

    // Clear session data
    this.sessions.clear();
    this.globalCache.clear();
    this.requestQueue = [];
    this.activeRequests.clear();

    this.removeAllListeners();
  }
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  constructor(count) {
    this.count = count;
    this.waiting = [];
  }

  async acquire() {
    if (this.count > 0) {
      this.count--;
      return () => this.release();
    }

    return new Promise(resolve => {
      this.waiting.push(() => {
        this.count--;
        resolve(() => this.release());
      });
    });
  }

  release() {
    this.count++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next();
    }
  }
}

module.exports = { MCPSystem, Semaphore };