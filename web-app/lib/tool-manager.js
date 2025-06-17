/**
 * Tool Management System
 * Handles dynamic tool registration, capability management, and permissions
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class ToolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      healthCheckInterval: options.healthCheckInterval || 60000,
      cacheTimeout: options.cacheTimeout || 300000, // 5 minutes
      ...options
    };

    this.tools = new Map();
    this.toolCategories = new Map();
    this.permissions = new Map();
    this.authTokens = new Map();
    this.toolCache = new Map();
    this.healthStatus = new Map();
    this.usageStats = new Map();
    this.rateLimits = new Map();
    
    this.startHealthMonitoring();
  }

  /**
   * Register a new tool with the system
   */
  async registerTool(toolDefinition, serverName, options = {}) {
    const toolId = `${serverName}_${toolDefinition.name}`;
    
    // Validate tool definition
    this.validateToolDefinition(toolDefinition);
    
    const tool = {
      id: toolId,
      serverName,
      name: toolDefinition.name,
      description: toolDefinition.description,
      inputSchema: toolDefinition.inputSchema,
      outputSchema: toolDefinition.outputSchema,
      category: this.categorizeTool(toolDefinition),
      capabilities: toolDefinition.capabilities || [],
      permissions: options.permissions || ['read'],
      rateLimits: options.rateLimits || { requests: 100, window: 3600000 }, // 100 requests per hour
      authRequired: options.authRequired || false,
      tags: toolDefinition.tags || [],
      version: toolDefinition.version || '1.0.0',
      registeredAt: Date.now(),
      lastUsed: null,
      usageCount: 0,
      enabled: true,
      metadata: toolDefinition.metadata || {}
    };

    this.tools.set(toolId, tool);
    this.initializeToolStats(toolId);
    
    // Update category mapping
    this.updateCategoryMapping(tool);
    
    // Initialize health status
    this.healthStatus.set(toolId, {
      status: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      responseTime: null
    });

    this.emit('toolRegistered', tool);
    return tool;
  }

  /**
   * Unregister a tool
   */
  async unregisterTool(toolId) {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    this.tools.delete(toolId);
    this.toolCache.delete(toolId);
    this.healthStatus.delete(toolId);
    this.usageStats.delete(toolId);
    this.rateLimits.delete(toolId);
    
    // Update category mapping
    this.removeCategoryMapping(tool);

    this.emit('toolUnregistered', tool);
  }

  /**
   * Get all available tools
   */
  getTools(filters = {}) {
    let tools = Array.from(this.tools.values());

    // Apply filters
    if (filters.category) {
      tools = tools.filter(tool => tool.category === filters.category);
    }

    if (filters.serverName) {
      tools = tools.filter(tool => tool.serverName === filters.serverName);
    }

    if (filters.enabled !== undefined) {
      tools = tools.filter(tool => tool.enabled === filters.enabled);
    }

    if (filters.permissions) {
      tools = tools.filter(tool => 
        filters.permissions.every(perm => tool.permissions.includes(perm))
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      tools = tools.filter(tool =>
        filters.tags.some(tag => tool.tags.includes(tag))
      );
    }

    if (filters.capabilities && filters.capabilities.length > 0) {
      tools = tools.filter(tool =>
        filters.capabilities.every(cap => tool.capabilities.includes(cap))
      );
    }

    // Sort by relevance and usage
    tools.sort((a, b) => {
      // Prioritize enabled tools
      if (a.enabled !== b.enabled) {
        return b.enabled - a.enabled;
      }
      
      // Sort by usage count
      return (b.usageCount || 0) - (a.usageCount || 0);
    });

    return tools;
  }

  /**
   * Get tool by ID
   */
  getTool(toolId) {
    return this.tools.get(toolId);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category) {
    return this.getTools({ category });
  }

  /**
   * Search tools by name, description, or tags
   */
  searchTools(query, options = {}) {
    const searchTerms = query.toLowerCase().split(' ');
    const tools = this.getTools(options.filters || {});

    return tools.filter(tool => {
      const searchableText = [
        tool.name,
        tool.description,
        ...tool.tags,
        tool.category
      ].join(' ').toLowerCase();

      return searchTerms.every(term => searchableText.includes(term));
    }).slice(0, options.limit || 20);
  }

  /**
   * Validate tool permissions for a user/session
   */
  checkPermissions(toolId, userId, requiredPermissions = []) {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    // Check if tool is enabled
    if (!tool.enabled) {
      throw new Error(`Tool ${toolId} is disabled`);
    }

    // Check tool permissions
    const hasPermissions = requiredPermissions.every(perm => 
      tool.permissions.includes(perm)
    );

    if (!hasPermissions) {
      throw new Error(`Insufficient permissions for tool ${toolId}`);
    }

    // Check authentication if required
    if (tool.authRequired) {
      const token = this.authTokens.get(userId);
      if (!token || !this.validateAuthToken(token, toolId)) {
        throw new Error(`Authentication required for tool ${toolId}`);
      }
    }

    // Check rate limits
    this.checkRateLimit(toolId, userId);

    return true;
  }

  /**
   * Check rate limits for a tool
   */
  checkRateLimit(toolId, userId) {
    const tool = this.tools.get(toolId);
    if (!tool || !tool.rateLimits) return true;

    const key = `${toolId}_${userId}`;
    const now = Date.now();
    
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, {
        requests: 0,
        windowStart: now
      });
    }

    const limits = this.rateLimits.get(key);
    
    // Reset window if expired
    if (now - limits.windowStart > tool.rateLimits.window) {
      limits.requests = 0;
      limits.windowStart = now;
    }

    // Check if rate limit exceeded
    if (limits.requests >= tool.rateLimits.requests) {
      const resetTime = limits.windowStart + tool.rateLimits.window;
      throw new Error(`Rate limit exceeded for tool ${toolId}. Reset at ${new Date(resetTime)}`);
    }

    limits.requests++;
    return true;
  }

  /**
   * Generate authentication token for a tool
   */
  generateAuthToken(userId, toolId, expiresIn = 3600000) { // 1 hour default
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + expiresIn;

    this.authTokens.set(userId, {
      token,
      toolId,
      expiresAt,
      createdAt: Date.now()
    });

    return token;
  }

  /**
   * Validate authentication token
   */
  validateAuthToken(token, toolId) {
    for (const [userId, tokenData] of this.authTokens) {
      if (tokenData.token === token && 
          tokenData.toolId === toolId && 
          tokenData.expiresAt > Date.now()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Record tool usage
   */
  recordUsage(toolId, userId, executionTime, success = true, metadata = {}) {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.usageCount++;
      tool.lastUsed = Date.now();
    }

    // Update usage statistics
    if (!this.usageStats.has(toolId)) {
      this.initializeToolStats(toolId);
    }

    const stats = this.usageStats.get(toolId);
    stats.totalCalls++;
    stats.totalExecutionTime += executionTime;
    stats.averageExecutionTime = stats.totalExecutionTime / stats.totalCalls;

    if (success) {
      stats.successfulCalls++;
    } else {
      stats.failedCalls++;
    }

    stats.successRate = (stats.successfulCalls / stats.totalCalls) * 100;
    stats.lastUsed = Date.now();

    // Record hourly usage
    const hour = Math.floor(Date.now() / 3600000);
    if (!stats.hourlyUsage.has(hour)) {
      stats.hourlyUsage.set(hour, 0);
    }
    stats.hourlyUsage.set(hour, stats.hourlyUsage.get(hour) + 1);

    this.emit('toolUsed', { toolId, userId, executionTime, success, metadata });
  }

  /**
   * Get tool usage statistics
   */
  getUsageStats(toolId) {
    return this.usageStats.get(toolId);
  }

  /**
   * Get system-wide statistics
   */
  getSystemStats() {
    const stats = {
      totalTools: this.tools.size,
      enabledTools: 0,
      disabledTools: 0,
      categoryCounts: {},
      totalUsage: 0,
      averageResponseTime: 0,
      healthyTools: 0,
      unhealthyTools: 0
    };

    let totalResponseTime = 0;
    let responseTimeCount = 0;

    for (const tool of this.tools.values()) {
      if (tool.enabled) {
        stats.enabledTools++;
      } else {
        stats.disabledTools++;
      }

      // Category counts
      stats.categoryCounts[tool.category] = (stats.categoryCounts[tool.category] || 0) + 1;

      // Usage stats
      const toolStats = this.usageStats.get(tool.id);
      if (toolStats) {
        stats.totalUsage += toolStats.totalCalls;
        if (toolStats.averageExecutionTime > 0) {
          totalResponseTime += toolStats.averageExecutionTime;
          responseTimeCount++;
        }
      }

      // Health stats
      const health = this.healthStatus.get(tool.id);
      if (health && health.status === 'healthy') {
        stats.healthyTools++;
      } else {
        stats.unhealthyTools++;
      }
    }

    if (responseTimeCount > 0) {
      stats.averageResponseTime = totalResponseTime / responseTimeCount;
    }

    return stats;
  }

  /**
   * Update tool configuration
   */
  async updateTool(toolId, updates) {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    const updatedTool = { ...tool, ...updates, updatedAt: Date.now() };
    
    // Validate if schema is being updated
    if (updates.inputSchema) {
      this.validateSchema(updates.inputSchema);
    }

    this.tools.set(toolId, updatedTool);
    this.emit('toolUpdated', updatedTool);
    
    return updatedTool;
  }

  /**
   * Enable/disable tool
   */
  async setToolEnabled(toolId, enabled) {
    return this.updateTool(toolId, { enabled });
  }

  /**
   * Check tool health
   */
  async checkToolHealth(toolId, serverConnection) {
    const startTime = Date.now();
    
    try {
      // Attempt to ping the tool or server
      await serverConnection.ping();
      
      const responseTime = Date.now() - startTime;
      
      this.healthStatus.set(toolId, {
        status: 'healthy',
        lastCheck: Date.now(),
        consecutiveFailures: 0,
        responseTime
      });

      return { status: 'healthy', responseTime };
    } catch (error) {
      const health = this.healthStatus.get(toolId) || { consecutiveFailures: 0 };
      health.status = 'unhealthy';
      health.lastCheck = Date.now();
      health.consecutiveFailures++;
      health.error = error.message;

      this.healthStatus.set(toolId, health);

      // Disable tool if too many consecutive failures
      if (health.consecutiveFailures >= this.options.maxRetries) {
        await this.setToolEnabled(toolId, false);
        this.emit('toolDisabled', { toolId, reason: 'health_check_failed' });
      }

      return { status: 'unhealthy', error: error.message };
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    this.healthInterval = setInterval(async () => {
      for (const [toolId, tool] of this.tools) {
        if (tool.enabled) {
          // Health check would need server connection - skip for now
          // await this.checkToolHealth(toolId, serverConnection);
        }
      }
    }, this.options.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of this.toolCache) {
      if (now - entry.timestamp > this.options.cacheTimeout) {
        this.toolCache.delete(key);
      }
    }
  }

  /**
   * Validate tool definition
   */
  validateToolDefinition(toolDefinition) {
    const required = ['name', 'description'];
    for (const field of required) {
      if (!toolDefinition[field]) {
        throw new Error(`Tool definition missing required field: ${field}`);
      }
    }

    if (toolDefinition.inputSchema) {
      this.validateSchema(toolDefinition.inputSchema);
    }
  }

  /**
   * Validate JSON schema
   */
  validateSchema(schema) {
    if (typeof schema !== 'object') {
      throw new Error('Schema must be an object');
    }
    
    if (schema.type && !['object', 'array', 'string', 'number', 'boolean'].includes(schema.type)) {
      throw new Error(`Invalid schema type: ${schema.type}`);
    }
  }

  /**
   * Categorize tool based on its definition
   */
  categorizeTool(toolDefinition) {
    const name = toolDefinition.name.toLowerCase();
    const description = (toolDefinition.description || '').toLowerCase();
    const text = name + ' ' + description;

    if (text.includes('search') || text.includes('query') || text.includes('find')) {
      return 'search';
    } else if (text.includes('create') || text.includes('add') || text.includes('insert')) {
      return 'create';
    } else if (text.includes('update') || text.includes('modify') || text.includes('edit')) {
      return 'update';
    } else if (text.includes('delete') || text.includes('remove')) {
      return 'delete';
    } else if (text.includes('export') || text.includes('download')) {
      return 'export';
    } else if (text.includes('analyze') || text.includes('report')) {
      return 'analytics';
    } else if (text.includes('file') || text.includes('document')) {
      return 'file';
    } else if (text.includes('web') || text.includes('http') || text.includes('api')) {
      return 'web';
    } else {
      return 'general';
    }
  }

  /**
   * Update category mapping
   */
  updateCategoryMapping(tool) {
    if (!this.toolCategories.has(tool.category)) {
      this.toolCategories.set(tool.category, new Set());
    }
    this.toolCategories.get(tool.category).add(tool.id);
  }

  /**
   * Remove category mapping
   */
  removeCategoryMapping(tool) {
    const categorySet = this.toolCategories.get(tool.category);
    if (categorySet) {
      categorySet.delete(tool.id);
      if (categorySet.size === 0) {
        this.toolCategories.delete(tool.category);
      }
    }
  }

  /**
   * Initialize tool statistics
   */
  initializeToolStats(toolId) {
    this.usageStats.set(toolId, {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      successRate: 0,
      lastUsed: null,
      hourlyUsage: new Map()
    });
  }

  /**
   * Export tool configuration
   */
  exportConfiguration() {
    const config = {
      tools: Array.from(this.tools.values()),
      categories: Object.fromEntries(
        Array.from(this.toolCategories.entries()).map(([cat, set]) => [cat, Array.from(set)])
      ),
      exportedAt: Date.now()
    };

    return JSON.stringify(config, null, 2);
  }

  /**
   * Import tool configuration
   */
  async importConfiguration(configJson) {
    const config = JSON.parse(configJson);
    
    // Clear existing tools
    this.tools.clear();
    this.toolCategories.clear();
    this.healthStatus.clear();
    this.usageStats.clear();

    // Import tools
    for (const tool of config.tools) {
      this.tools.set(tool.id, tool);
      this.updateCategoryMapping(tool);
      this.initializeToolStats(tool.id);
    }

    this.emit('configurationImported', config);
  }

  /**
   * Cleanup resources
   */
  async shutdown() {
    this.stopHealthMonitoring();
    this.removeAllListeners();
    
    // Clear all maps
    this.tools.clear();
    this.toolCategories.clear();
    this.permissions.clear();
    this.authTokens.clear();
    this.toolCache.clear();
    this.healthStatus.clear();
    this.usageStats.clear();
    this.rateLimits.clear();
  }
}

module.exports = { ToolManager };