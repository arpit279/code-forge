/**
 * Natural Language Processing Pipeline for MCP Tool Integration
 * Handles intent recognition, entity extraction, and tool selection
 */

class NLPProcessor {
  constructor(options = {}) {
    this.options = {
      confidenceThreshold: options.confidenceThreshold || 0.7,
      maxSuggestions: options.maxSuggestions || 3,
      contextWindow: options.contextWindow || 5,
      ...options
    };

    this.intentPatterns = new Map();
    this.entityExtractors = new Map();
    this.conversationContext = new Map();
    this.toolMappings = new Map();
    
    this.initializePatterns();
  }

  /**
   * Initialize intent recognition patterns
   */
  initializePatterns() {
    // Define intent patterns with regex and keywords
    this.intentPatterns.set('search', {
      patterns: [
        /\b(search|find|look\s+for|locate|query)\b/i,
        /\b(what|where|when|who|how)\b.*\b(is|are|was|were)\b/i,
        /\bshow\s+me\b/i,
        /\bget\s+(information|data|details)\b/i
      ],
      keywords: ['search', 'find', 'query', 'lookup', 'information', 'data'],
      confidence: 0.8
    });

    this.intentPatterns.set('create', {
      patterns: [
        /\b(create|make|generate|build|add|new)\b/i,
        /\bset\s+up\b/i,
        /\bstart\s+(a|an|new)\b/i
      ],
      keywords: ['create', 'make', 'generate', 'build', 'add', 'new', 'setup'],
      confidence: 0.85
    });

    this.intentPatterns.set('update', {
      patterns: [
        /\b(update|modify|change|edit|alter|revise)\b/i,
        /\bset\s+to\b/i,
        /\bmake\s+it\b/i
      ],
      keywords: ['update', 'modify', 'change', 'edit', 'alter', 'set'],
      confidence: 0.8
    });

    this.intentPatterns.set('delete', {
      patterns: [
        /\b(delete|remove|clear|drop|eliminate)\b/i,
        /\bget\s+rid\s+of\b/i
      ],
      keywords: ['delete', 'remove', 'clear', 'drop', 'eliminate'],
      confidence: 0.9
    });

    this.intentPatterns.set('analyze', {
      patterns: [
        /\b(analyze|examine|review|check|inspect|evaluate)\b/i,
        /\bwhat\s+(does|is|are)\b.*\bmean\b/i,
        /\btell\s+me\s+about\b/i
      ],
      keywords: ['analyze', 'examine', 'review', 'check', 'inspect', 'evaluate'],
      confidence: 0.75
    });

    this.intentPatterns.set('export', {
      patterns: [
        /\b(export|download|save|backup|extract)\b/i,
        /\bget\s+(csv|json|pdf|excel)\b/i
      ],
      keywords: ['export', 'download', 'save', 'backup', 'extract', 'csv', 'json', 'pdf'],
      confidence: 0.85
    });

    this.intentPatterns.set('list', {
      patterns: [
        /\b(list|show|display|get)\s+(all|my|the)\b/i,
        /\bwhat\s+(are|is)\s+(all|my|the)\b/i
      ],
      keywords: ['list', 'show', 'display', 'all', 'my'],
      confidence: 0.8
    });
  }

  /**
   * Process user input and extract intent, entities, and tool suggestions
   */
  async processInput(input, conversationId = 'default', availableTools = []) {
    const normalizedInput = this.normalizeInput(input);
    
    // Extract intent
    const intents = this.extractIntents(normalizedInput);
    
    // Extract entities
    const entities = this.extractEntities(normalizedInput);
    
    // Get conversation context
    const context = this.getConversationContext(conversationId);
    
    // Select appropriate tools
    const toolSuggestions = this.selectTools(intents, entities, context, availableTools);
    
    // Update conversation context
    this.updateConversationContext(conversationId, {
      input: normalizedInput,
      intents,
      entities,
      timestamp: Date.now()
    });

    return {
      originalInput: input,
      normalizedInput,
      intents,
      entities,
      context,
      toolSuggestions,
      confidence: this.calculateOverallConfidence(intents, entities, toolSuggestions)
    };
  }

  /**
   * Normalize input text
   */
  normalizeInput(input) {
    return input
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract intents from input
   */
  extractIntents(input) {
    const intents = [];

    for (const [intentName, intentData] of this.intentPatterns) {
      let score = 0;
      let matches = 0;

      // Check regex patterns
      for (const pattern of intentData.patterns) {
        if (pattern.test(input)) {
          score += 0.5;
          matches++;
        }
      }

      // Check keywords
      const words = input.split(' ');
      for (const keyword of intentData.keywords) {
        if (words.includes(keyword)) {
          score += 0.3;
          matches++;
        }
      }

      if (matches > 0) {
        const confidence = Math.min(score * intentData.confidence, 1.0);
        if (confidence >= this.options.confidenceThreshold) {
          intents.push({
            name: intentName,
            confidence,
            matches,
            evidence: intentData.keywords.filter(k => words.includes(k))
          });
        }
      }
    }

    return intents.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract entities from input
   */
  extractEntities(input) {
    const entities = {
      objects: this.extractObjects(input),
      identifiers: this.extractIdentifiers(input),
      filters: this.extractFilters(input),
      formats: this.extractFormats(input),
      numbers: this.extractNumbers(input),
      dates: this.extractDates(input)
    };

    return entities;
  }

  extractObjects(input) {
    const objectPatterns = [
      /\b(account|contact|opportunity|lead|case|task|event|campaign|user|record)s?\b/gi,
      /\b(customer|client|prospect|deal|ticket|order|invoice|product)s?\b/gi
    ];

    const objects = [];
    for (const pattern of objectPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        objects.push(...matches.map(m => m.toLowerCase().replace(/s$/, '')));
      }
    }

    return [...new Set(objects)];
  }

  extractIdentifiers(input) {
    const identifiers = [];
    
    // Extract IDs (alphanumeric strings that look like IDs)
    const idPattern = /\b[A-Za-z0-9]{15,18}\b/g;
    const idMatches = input.match(idPattern);
    if (idMatches) {
      identifiers.push(...idMatches.map(id => ({ type: 'id', value: id })));
    }

    // Extract email addresses
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emailMatches = input.match(emailPattern);
    if (emailMatches) {
      identifiers.push(...emailMatches.map(email => ({ type: 'email', value: email })));
    }

    // Extract names (quoted strings or proper nouns)
    const namePattern = /"([^"]+)"|'([^']+)'/g;
    let match;
    while ((match = namePattern.exec(input)) !== null) {
      identifiers.push({ type: 'name', value: match[1] || match[2] });
    }

    return identifiers;
  }

  extractFilters(input) {
    const filters = [];
    
    // Extract field comparisons (field = value, field > value, etc.)
    const filterPattern = /\b(\w+)\s*(=|>|<|>=|<=|!=|like|contains)\s*([^,\s]+)/gi;
    let match;
    while ((match = filterPattern.exec(input)) !== null) {
      filters.push({
        field: match[1],
        operator: match[2],
        value: match[3].replace(/['"]/g, '')
      });
    }

    return filters;
  }

  extractFormats(input) {
    const formatPattern = /\b(csv|json|xml|pdf|excel|xlsx)\b/gi;
    const matches = input.match(formatPattern);
    return matches ? matches.map(f => f.toLowerCase()) : [];
  }

  extractNumbers(input) {
    const numberPattern = /\b\d+(\.\d+)?\b/g;
    const matches = input.match(numberPattern);
    return matches ? matches.map(n => parseFloat(n)) : [];
  }

  extractDates(input) {
    const dates = [];
    
    // Simple date patterns (can be enhanced)
    const datePatterns = [
      /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g,
      /\b(\d{4}-\d{2}-\d{2})\b/g,
      /\b(today|yesterday|tomorrow)\b/gi,
      /\b(last|this|next)\s+(week|month|year)\b/gi
    ];

    for (const pattern of datePatterns) {
      const matches = input.match(pattern);
      if (matches) {
        dates.push(...matches);
      }
    }

    return dates;
  }

  /**
   * Select appropriate tools based on intents and entities
   */
  selectTools(intents, entities, context, availableTools) {
    const suggestions = [];

    if (!intents.length || !availableTools.length) {
      return suggestions;
    }

    const primaryIntent = intents[0];

    for (const tool of availableTools) {
      const score = this.calculateToolScore(tool, primaryIntent, entities, context);
      
      if (score > 0) {
        const parameters = this.suggestParameters(tool, entities, context);
        
        suggestions.push({
          tool,
          score,
          parameters,
          reasoning: this.generateReasoning(tool, primaryIntent, entities),
          confidence: Math.min(score * primaryIntent.confidence, 1.0)
        });
      }
    }

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, this.options.maxSuggestions);
  }

  /**
   * Calculate how well a tool matches the intent and entities
   */
  calculateToolScore(tool, intent, entities, context) {
    let score = 0;

    // Intent matching
    const toolName = tool.name.toLowerCase();
    const toolDescription = (tool.description || '').toLowerCase();
    
    if (intent.name === 'search' && (toolName.includes('query') || toolName.includes('search') || toolName.includes('list'))) {
      score += 0.8;
    } else if (intent.name === 'create' && (toolName.includes('create') || toolName.includes('add') || toolName.includes('insert'))) {
      score += 0.8;
    } else if (intent.name === 'update' && (toolName.includes('update') || toolName.includes('modify') || toolName.includes('edit'))) {
      score += 0.8;
    } else if (intent.name === 'delete' && (toolName.includes('delete') || toolName.includes('remove'))) {
      score += 0.8;
    } else if (intent.name === 'export' && (toolName.includes('export') || toolName.includes('download'))) {
      score += 0.8;
    } else if (intent.name === 'list' && (toolName.includes('list') || toolName.includes('get') || toolName.includes('query'))) {
      score += 0.7;
    }

    // Entity matching
    if (entities.objects.length > 0) {
      for (const obj of entities.objects) {
        if (toolDescription.includes(obj) || toolName.includes(obj)) {
          score += 0.3;
        }
      }
    }

    // Parameter compatibility
    if (tool.inputSchema && tool.inputSchema.properties) {
      const params = Object.keys(tool.inputSchema.properties);
      
      // Check if we have entities that match parameter names
      for (const param of params) {
        if (entities.identifiers.some(id => id.type === param)) {
          score += 0.2;
        }
        if (entities.filters.some(f => f.field === param)) {
          score += 0.2;
        }
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * Suggest parameters for a tool based on extracted entities
   */
  suggestParameters(tool, entities, context) {
    const parameters = {};

    if (!tool.inputSchema || !tool.inputSchema.properties) {
      return parameters;
    }

    const schema = tool.inputSchema.properties;

    // Map entities to parameters
    for (const [paramName, paramSchema] of Object.entries(schema)) {
      const paramType = paramSchema.type;
      
      if (paramType === 'string') {
        // Try to match with identifiers
        const identifier = entities.identifiers.find(id => 
          id.type === paramName || 
          paramName.toLowerCase().includes(id.type)
        );
        if (identifier) {
          parameters[paramName] = identifier.value;
          continue;
        }

        // Try to match with object names
        if (paramName.toLowerCase().includes('object') || paramName.toLowerCase().includes('type')) {
          if (entities.objects.length > 0) {
            parameters[paramName] = entities.objects[0];
            continue;
          }
        }

        // Try to match with filters for query parameters
        if (paramName.toLowerCase().includes('query') || paramName.toLowerCase().includes('soql')) {
          if (entities.filters.length > 0) {
            const filter = entities.filters[0];
            parameters[paramName] = `SELECT Id FROM ${entities.objects[0] || 'Account'} WHERE ${filter.field} ${filter.operator} '${filter.value}'`;
            continue;
          }
        }
      }

      if (paramType === 'number' && entities.numbers.length > 0) {
        parameters[paramName] = entities.numbers[0];
      }

      if (paramType === 'array' && paramSchema.items && paramSchema.items.type === 'string') {
        if (paramName.toLowerCase().includes('field')) {
          // For field arrays, suggest common fields
          parameters[paramName] = ['Id', 'Name'];
        }
      }
    }

    return parameters;
  }

  /**
   * Generate human-readable reasoning for tool selection
   */
  generateReasoning(tool, intent, entities) {
    const reasons = [];

    reasons.push(`Tool "${tool.name}" matches intent "${intent.name}"`);

    if (entities.objects.length > 0) {
      reasons.push(`Works with ${entities.objects.join(', ')} objects`);
    }

    if (entities.identifiers.length > 0) {
      reasons.push(`Can use provided identifiers`);
    }

    return reasons.join('; ');
  }

  /**
   * Get conversation context
   */
  getConversationContext(conversationId) {
    const context = this.conversationContext.get(conversationId) || [];
    return context.slice(-this.options.contextWindow);
  }

  /**
   * Update conversation context
   */
  updateConversationContext(conversationId, entry) {
    if (!this.conversationContext.has(conversationId)) {
      this.conversationContext.set(conversationId, []);
    }

    const context = this.conversationContext.get(conversationId);
    context.push(entry);

    // Keep only recent entries
    if (context.length > this.options.contextWindow * 2) {
      context.splice(0, context.length - this.options.contextWindow);
    }
  }

  /**
   * Calculate overall confidence score
   */
  calculateOverallConfidence(intents, entities, toolSuggestions) {
    if (!intents.length) return 0;

    const intentConfidence = intents[0].confidence;
    const entityScore = Math.min((entities.objects.length + entities.identifiers.length) * 0.1, 0.5);
    const toolScore = toolSuggestions.length > 0 ? toolSuggestions[0].confidence : 0;

    return Math.min((intentConfidence + entityScore + toolScore) / 3, 1.0);
  }

  /**
   * Handle disambiguation when multiple intents or tools are possible
   */
  disambiguate(results) {
    if (results.intents.length <= 1 && results.toolSuggestions.length <= 1) {
      return null; // No ambiguity
    }

    const questions = [];

    if (results.intents.length > 1) {
      const topIntents = results.intents.slice(0, 3);
      questions.push({
        type: 'intent_clarification',
        question: `I see multiple possible actions. Did you want to ${topIntents.map(i => i.name).join(', or ')}?`,
        options: topIntents.map(intent => ({
          label: this.intentToAction(intent.name),
          value: intent.name
        }))
      });
    }

    if (results.toolSuggestions.length > 1) {
      const topTools = results.toolSuggestions.slice(0, 3);
      questions.push({
        type: 'tool_selection',
        question: 'Which tool would you like to use?',
        options: topTools.map(suggestion => ({
          label: `${suggestion.tool.name} - ${suggestion.tool.description || ''}`,
          value: suggestion.tool.name,
          parameters: suggestion.parameters
        }))
      });
    }

    return {
      needsDisambiguation: true,
      questions,
      originalResults: results
    };
  }

  intentToAction(intentName) {
    const actions = {
      'search': 'search for information',
      'create': 'create something new',
      'update': 'update existing data',
      'delete': 'delete something',
      'analyze': 'analyze data',
      'export': 'export data',
      'list': 'list items'
    };
    return actions[intentName] || intentName;
  }

  /**
   * Clear conversation context
   */
  clearContext(conversationId = null) {
    if (conversationId) {
      this.conversationContext.delete(conversationId);
    } else {
      this.conversationContext.clear();
    }
  }
}

module.exports = { NLPProcessor };