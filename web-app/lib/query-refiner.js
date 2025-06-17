/**
 * Intelligent Query Refinement System
 * Automatically refines and retries failed queries with different variations
 */

class QueryRefiner {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 5,
      retryDelay: options.retryDelay || 500,
      enableLearning: options.enableLearning !== false,
      ...options
    };

    this.refinementStrategies = new Map();
    this.failurePatterns = new Map();
    this.successPatterns = new Map();
    
    this.initializeStrategies();
  }

  /**
   * Initialize refinement strategies for different query types and error patterns
   */
  initializeStrategies() {
    // SOSL query refinement strategies
    this.refinementStrategies.set('sosl', [
      {
        name: 'remove_special_characters',
        description: 'Remove special characters that cause parsing errors',
        apply: (query, error) => {
          if (error.includes('MALFORMED_SEARCH') || error.includes('ERROR at Row')) {
            return query.replace(/[&+\-(){}[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
          }
          return null;
        }
      },
      {
        name: 'escape_special_characters',
        description: 'Escape special characters properly',
        apply: (query, error) => {
          if (error.includes('MALFORMED_SEARCH')) {
            return query.replace(/[&+\-(){}[\]]/g, '\\$&');
          }
          return null;
        }
      },
      {
        name: 'split_compound_terms',
        description: 'Split compound search terms',
        apply: (query, error) => {
          if (error.includes('No search term found') || error.includes('MALFORMED_SEARCH')) {
            // Split terms like "Moore & Sons" into "Moore Sons"
            return query.replace(/\s*[&+]\s*/g, ' ').replace(/\s+/g, ' ').trim();
          }
          return null;
        }
      },
      {
        name: 'quote_individual_terms',
        description: 'Quote individual terms for exact matching',
        apply: (query, error) => {
          if (error.includes('MALFORMED_SEARCH')) {
            const words = query.split(/\s+/);
            if (words.length > 1) {
              return words.map(word => `"${word}"`).join(' ');
            }
          }
          return null;
        }
      },
      {
        name: 'use_wildcards',
        description: 'Add wildcards for partial matching',
        apply: (query, error) => {
          if (error.includes('No search term found') || query.length < 3) {
            const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
            if (cleanQuery.length >= 2) {
              return `${cleanQuery}*`;
            }
          }
          return null;
        }
      },
      {
        name: 'simplify_to_first_word',
        description: 'Use only the first significant word',
        apply: (query, error) => {
          const words = query.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
          if (words.length > 0) {
            return words[0];
          }
          return null;
        }
      }
    ]);

    // SOQL query refinement strategies
    this.refinementStrategies.set('soql', [
      {
        name: 'escape_single_quotes',
        description: 'Properly escape single quotes in SOQL',
        apply: (query, error) => {
          if (error.includes('MALFORMED_QUERY') || error.includes("unexpected token: '''")) {
            return query.replace(/'/g, "\\'");
          }
          return null;
        }
      },
      {
        name: 'fix_like_wildcards',
        description: 'Fix LIKE wildcard syntax',
        apply: (query, error) => {
          if (error.includes('LIKE') || error.includes('MALFORMED_QUERY')) {
            // Ensure LIKE clauses have proper wildcards
            return query.replace(/LIKE\s+'([^']+)'/gi, (match, term) => {
              if (!term.includes('%')) {
                return `LIKE '%${term}%'`;
              }
              return match;
            });
          }
          return null;
        }
      },
      {
        name: 'simplify_where_clause',
        description: 'Simplify complex WHERE clauses',
        apply: (query, error) => {
          if (error.includes('MALFORMED_QUERY')) {
            // Extract the SELECT and FROM parts, simplify WHERE
            const selectMatch = query.match(/(SELECT\s+.+?\s+FROM\s+\w+)/i);
            if (selectMatch) {
              const baseQuery = selectMatch[1];
              const whereMatch = query.match(/WHERE\s+(.+)/i);
              if (whereMatch) {
                const whereClause = whereMatch[1];
                // Simplify to first condition only
                const firstCondition = whereClause.split(/\s+(AND|OR)\s+/i)[0];
                return `${baseQuery} WHERE ${firstCondition}`;
              }
            }
          }
          return null;
        }
      },
      {
        name: 'remove_invalid_fields',
        description: 'Remove potentially invalid field names',
        apply: (query, error) => {
          if (error.includes('No such column') || error.includes('INVALID_FIELD')) {
            // Use basic fields only
            return query.replace(/SELECT\s+.+?\s+FROM/i, 'SELECT Id, Name FROM');
          }
          return null;
        }
      }
    ]);

    // General API refinement strategies
    this.refinementStrategies.set('general', [
      {
        name: 'reduce_complexity',
        description: 'Reduce query complexity',
        apply: (query, error) => {
          if (error.includes('LIMIT_EXCEEDED') || error.includes('TIMEOUT')) {
            // Add or reduce LIMIT
            if (query.includes('LIMIT')) {
              return query.replace(/LIMIT\s+\d+/i, 'LIMIT 10');
            } else {
              return query + ' LIMIT 10';
            }
          }
          return null;
        }
      },
      {
        name: 'handle_encoding_issues',
        description: 'Fix encoding and character issues',
        apply: (query, error) => {
          if (error.includes('encoding') || error.includes('character')) {
            return query.replace(/[^\x00-\x7F]/g, ''); // Remove non-ASCII characters
          }
          return null;
        }
      }
    ]);
  }

  /**
   * Refine and retry a query with automatic fallbacks
   */
  async refineAndRetry(queryFunction, queryType, originalQuery, originalParams = {}) {
    const attempts = [];
    let lastError = null;
    let currentQuery = originalQuery;
    let currentParams = { ...originalParams };

    // Try original query first
    try {
      const result = await queryFunction(currentQuery, currentParams);
      this.recordSuccess(queryType, originalQuery, currentQuery, 0);
      return {
        success: true,
        result,
        originalQuery,
        finalQuery: currentQuery,
        attempts: 1,
        refinements: []
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        query: currentQuery,
        error: error.message,
        strategy: 'original'
      });
    }

    // Try refinement strategies
    const strategies = this.getRefinementStrategies(queryType);
    const refinements = [];

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      const strategy = strategies[attempt - 1];
      if (!strategy) break;

      try {
        const refinedQuery = this.applyStrategy(strategy, currentQuery, lastError.message);
        if (!refinedQuery || refinedQuery === currentQuery) {
          continue; // Skip if strategy doesn't apply or produces same query
        }

        currentQuery = refinedQuery;
        refinements.push({
          strategy: strategy.name,
          description: strategy.description,
          query: refinedQuery
        });

        // Add delay between attempts
        if (this.options.retryDelay > 0) {
          await this.sleep(this.options.retryDelay);
        }

        const result = await queryFunction(currentQuery, currentParams);
        
        // Success! Record the successful pattern
        this.recordSuccess(queryType, originalQuery, currentQuery, attempt);
        
        return {
          success: true,
          result,
          originalQuery,
          finalQuery: currentQuery,
          attempts: attempt + 1,
          refinements,
          successfulStrategy: strategy.name
        };

      } catch (error) {
        lastError = error;
        attempts.push({
          query: currentQuery,
          error: error.message,
          strategy: strategy.name
        });

        // Record failure pattern for learning
        this.recordFailure(queryType, strategy.name, error.message);
      }
    }

    // All attempts failed
    return {
      success: false,
      error: lastError.message,
      originalQuery,
      finalQuery: currentQuery,
      attempts: attempts.length,
      refinements,
      allAttempts: attempts
    };
  }

  /**
   * Get refinement strategies for a query type
   */
  getRefinementStrategies(queryType) {
    const specificStrategies = this.refinementStrategies.get(queryType) || [];
    const generalStrategies = this.refinementStrategies.get('general') || [];
    
    // Combine and prioritize based on past success rates
    const allStrategies = [...specificStrategies, ...generalStrategies];
    
    if (this.options.enableLearning) {
      return this.prioritizeStrategies(queryType, allStrategies);
    }
    
    return allStrategies;
  }

  /**
   * Apply a refinement strategy to a query
   */
  applyStrategy(strategy, query, error) {
    try {
      return strategy.apply(query, error);
    } catch (strategyError) {
      console.error(`Strategy ${strategy.name} failed:`, strategyError);
      return null;
    }
  }

  /**
   * Prioritize strategies based on past success rates
   */
  prioritizeStrategies(queryType, strategies) {
    const key = `${queryType}_strategies`;
    const successRates = this.successPatterns.get(key) || new Map();

    return strategies.sort((a, b) => {
      const aRate = successRates.get(a.name) || 0;
      const bRate = successRates.get(b.name) || 0;
      return bRate - aRate; // Higher success rate first
    });
  }

  /**
   * Record successful query refinement
   */
  recordSuccess(queryType, originalQuery, finalQuery, attempts) {
    if (!this.options.enableLearning) return;

    const key = `${queryType}_success`;
    if (!this.successPatterns.has(key)) {
      this.successPatterns.set(key, new Map());
    }

    const successMap = this.successPatterns.get(key);
    const pattern = this.extractPattern(originalQuery, finalQuery);
    
    successMap.set(pattern, (successMap.get(pattern) || 0) + 1);

    // Also record strategy success rates
    const strategyKey = `${queryType}_strategies`;
    if (attempts > 0 && !this.successPatterns.has(strategyKey)) {
      this.successPatterns.set(strategyKey, new Map());
    }
  }

  /**
   * Record failed refinement attempt
   */
  recordFailure(queryType, strategyName, error) {
    if (!this.options.enableLearning) return;

    const key = `${queryType}_failures`;
    if (!this.failurePatterns.has(key)) {
      this.failurePatterns.set(key, new Map());
    }

    const failureMap = this.failurePatterns.get(key);
    const pattern = `${strategyName}:${this.categorizeError(error)}`;
    
    failureMap.set(pattern, (failureMap.get(pattern) || 0) + 1);
  }

  /**
   * Extract pattern from query transformation
   */
  extractPattern(originalQuery, finalQuery) {
    if (originalQuery === finalQuery) return 'no_change';
    
    const originalLen = originalQuery.length;
    const finalLen = finalQuery.length;
    
    if (finalLen < originalLen * 0.5) return 'significant_reduction';
    if (finalLen < originalLen * 0.8) return 'moderate_reduction';
    if (finalLen > originalLen * 1.2) return 'expansion';
    
    if (originalQuery.includes('&') && !finalQuery.includes('&')) return 'special_char_removal';
    if (originalQuery.includes('"') !== finalQuery.includes('"')) return 'quote_change';
    
    return 'minor_modification';
  }

  /**
   * Categorize error for pattern learning
   */
  categorizeError(error) {
    const errorLower = error.toLowerCase();
    
    if (errorLower.includes('malformed')) return 'malformed';
    if (errorLower.includes('syntax')) return 'syntax';
    if (errorLower.includes('invalid field')) return 'invalid_field';
    if (errorLower.includes('no such column')) return 'invalid_field';
    if (errorLower.includes('timeout')) return 'timeout';
    if (errorLower.includes('limit')) return 'limit_exceeded';
    if (errorLower.includes('permission')) return 'permission';
    if (errorLower.includes('not found')) return 'not_found';
    
    return 'unknown';
  }

  /**
   * Get refinement statistics
   */
  getStats() {
    const stats = {
      successPatterns: {},
      failurePatterns: {},
      totalSuccesses: 0,
      totalFailures: 0
    };

    for (const [key, map] of this.successPatterns) {
      stats.successPatterns[key] = Object.fromEntries(map);
      stats.totalSuccesses += Array.from(map.values()).reduce((sum, count) => sum + count, 0);
    }

    for (const [key, map] of this.failurePatterns) {
      stats.failurePatterns[key] = Object.fromEntries(map);
      stats.totalFailures += Array.from(map.values()).reduce((sum, count) => sum + count, 0);
    }

    stats.successRate = stats.totalSuccesses / (stats.totalSuccesses + stats.totalFailures) || 0;

    return stats;
  }

  /**
   * Add custom refinement strategy
   */
  addStrategy(queryType, strategy) {
    if (!this.refinementStrategies.has(queryType)) {
      this.refinementStrategies.set(queryType, []);
    }
    
    this.refinementStrategies.get(queryType).push(strategy);
  }

  /**
   * Clear learning data
   */
  clearLearningData() {
    this.successPatterns.clear();
    this.failurePatterns.clear();
  }

  /**
   * Sleep utility for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * SOSL Query Builder with refinement capabilities
 */
class SOSLQueryBuilder {
  static buildSearchQuery(searchTerm, objects = ['Account', 'Contact', 'Opportunity']) {
    const cleanTerm = searchTerm.trim();
    
    // Build RETURNING clause
    const returning = objects.map(obj => {
      switch (obj) {
        case 'Account':
          return 'Account(Id, Name, Type, Industry, Phone, Website, BillingAddress)';
        case 'Contact':
          return 'Contact(Id, Name, Title, Email, Phone, AccountId)';
        case 'Opportunity':
          return 'Opportunity(Id, Name, StageName, Amount, CloseDate, AccountId)';
        default:
          return `${obj}(Id, Name)`;
      }
    }).join(', ');

    return `FIND {${cleanTerm}} IN ALL FIELDS RETURNING ${returning}`;
  }

  static buildAccountQuery(searchTerm, fields = ['Id', 'Name', 'Type', 'Industry']) {
    const cleanTerm = searchTerm.replace(/'/g, "\\'");
    const fieldList = fields.join(', ');
    
    return `SELECT ${fieldList} FROM Account WHERE Name LIKE '%${cleanTerm}%'`;
  }
}

/**
 * Integration helper for MCP system
 */
class MCPQueryRefiner {
  constructor(mcpSystem, options = {}) {
    this.mcpSystem = mcpSystem;
    this.queryRefiner = new QueryRefiner(options);
    this.setupSalesforceStrategies();
  }

  /**
   * Setup Salesforce-specific refinement strategies
   */
  setupSalesforceStrategies() {
    // Add Salesforce-specific SOSL strategies
    this.queryRefiner.addStrategy('salesforce_search', {
      name: 'fallback_to_soql',
      description: 'Fallback from SOSL to SOQL query',
      apply: (query, error) => {
        if (error.includes('MALFORMED_SEARCH') && query.includes('FIND')) {
          // Extract search term and convert to SOQL
          const termMatch = query.match(/FIND\s*\{([^}]+)\}/);
          if (termMatch) {
            const searchTerm = termMatch[1].trim();
            return SOSLQueryBuilder.buildAccountQuery(searchTerm);
          }
        }
        return null;
      }
    });

    this.queryRefiner.addStrategy('salesforce_search', {
      name: 'use_name_only_search',
      description: 'Search only in Name field',
      apply: (query, error) => {
        if (error.includes('MALFORMED_SEARCH')) {
          const termMatch = query.match(/FIND\s*\{([^}]+)\}/);
          if (termMatch) {
            const searchTerm = termMatch[1].trim();
            return `FIND {${searchTerm}} IN NAME FIELDS RETURNING Account(Id, Name, Type)`;
          }
        }
        return null;
      }
    });
  }

  /**
   * Execute Salesforce search with automatic refinement
   */
  async executeSearch(searchTerm, toolName = 'salesforce_search') {
    const originalQuery = SOSLQueryBuilder.buildSearchQuery(searchTerm);
    
    const queryFunction = async (query, params) => {
      return await this.mcpSystem.mcpCore.callTool(toolName, {
        sosl_query: query,
        ...params
      });
    };

    return await this.queryRefiner.refineAndRetry(
      queryFunction,
      'salesforce_search',
      originalQuery
    );
  }

  /**
   * Execute SOQL query with refinement
   */
  async executeQuery(query, toolName = 'salesforce_query') {
    const queryFunction = async (soqlQuery, params) => {
      return await this.mcpSystem.mcpCore.callTool(toolName, {
        soql_query: soqlQuery,
        ...params
      });
    };

    return await this.queryRefiner.refineAndRetry(
      queryFunction,
      'soql',
      query
    );
  }

  /**
   * Get refinement statistics
   */
  getStats() {
    return this.queryRefiner.getStats();
  }
}

module.exports = {
  QueryRefiner,
  SOSLQueryBuilder,
  MCPQueryRefiner
};