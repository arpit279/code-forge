/**
 * Response Processing & Presentation Layer
 * Handles tool response synthesis, citation, and rich media presentation
 */

const EventEmitter = require('events');

class ResponseProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxCitationAge: options.maxCitationAge || 3600000, // 1 hour
      enableCaching: options.enableCaching !== false,
      cacheTimeout: options.cacheTimeout || 300000, // 5 minutes
      maxResponseLength: options.maxResponseLength || 10000,
      ...options
    };

    this.responseCache = new Map();
    this.citationTracker = new Map();
    this.templateEngine = new TemplateEngine();
    
    this.initializeFormatters();
  }

  /**
   * Process and synthesize multiple tool responses
   */
  async processToolResponses(responses, context = {}) {
    const processedResponses = [];
    const citations = [];
    let synthesizedResponse = '';

    try {
      // Process each response
      for (const response of responses) {
        const processed = await this.processIndividualResponse(response, context);
        processedResponses.push(processed);

        // Extract citations
        if (processed.citations) {
          citations.push(...processed.citations);
        }
      }

      // Synthesize responses if multiple
      if (processedResponses.length > 1) {
        synthesizedResponse = await this.synthesizeResponses(processedResponses, context);
      } else if (processedResponses.length === 1) {
        synthesizedResponse = processedResponses[0].formattedResponse;
      }

      // Create final response object
      const finalResponse = {
        success: true,
        content: synthesizedResponse,
        citations: this.deduplicateCitations(citations),
        metadata: {
          toolsUsed: responses.map(r => r.toolName),
          processedAt: Date.now(),
          responseCount: responses.length,
          confidence: this.calculateConfidence(processedResponses)
        },
        rawResponses: processedResponses,
        richMedia: this.extractRichMedia(processedResponses)
      };

      // Cache the response
      if (this.options.enableCaching) {
        this.cacheResponse(context.inputHash, finalResponse);
      }

      this.emit('responseProcessed', finalResponse);
      return finalResponse;

    } catch (error) {
      console.error('Response processing failed:', error);
      return {
        success: false,
        error: error.message,
        content: 'I encountered an error while processing the tool responses.',
        metadata: {
          processedAt: Date.now(),
          error: error.message
        }
      };
    }
  }

  /**
   * Process individual tool response
   */
  async processIndividualResponse(response, context) {
    const processed = {
      toolName: response.toolName,
      serverName: response.serverName,
      success: response.success,
      rawData: response.result,
      formattedResponse: '',
      citations: [],
      metadata: response.metadata || {},
      dataType: this.detectDataType(response.result),
      confidence: 1.0
    };

    if (!response.success) {
      processed.formattedResponse = `Error from ${response.toolName}: ${response.error}`;
      processed.confidence = 0;
      return processed;
    }

    try {
      // Format the response based on data type
      processed.formattedResponse = await this.formatResponse(response.result, processed.dataType, context);
      
      // Extract citations
      processed.citations = this.extractCitations(response, context);
      
      // Calculate confidence based on response quality
      processed.confidence = this.assessResponseQuality(response.result, processed.dataType);

    } catch (error) {
      console.error(`Failed to process response from ${response.toolName}:`, error);
      processed.formattedResponse = `Unable to process response from ${response.toolName}`;
      processed.confidence = 0.1;
    }

    return processed;
  }

  /**
   * Detect the type of data in the response
   */
  detectDataType(data) {
    if (!data) return 'empty';
    
    if (typeof data === 'string') {
      // Check for common formats
      if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
        try {
          JSON.parse(data);
          return 'json';
        } catch {
          return 'text';
        }
      }
      
      if (data.includes('<') && data.includes('>')) {
        return 'html';
      }
      
      if (data.includes('\n') && (data.includes(',') || data.includes('\t'))) {
        return 'csv';
      }
      
      return 'text';
    }
    
    if (Array.isArray(data)) {
      return 'array';
    }
    
    if (typeof data === 'object') {
      // Check for specific object types
      if (data.records && Array.isArray(data.records)) {
        return 'recordset';
      }
      
      if (data.content && data.mimeType) {
        return 'media';
      }
      
      return 'object';
    }
    
    if (typeof data === 'number') {
      return 'number';
    }
    
    return 'unknown';
  }

  /**
   * Format response based on data type
   */
  async formatResponse(data, dataType, context) {
    switch (dataType) {
      case 'recordset':
        return this.formatRecordset(data, context);
      
      case 'array':
        return this.formatArray(data, context);
      
      case 'object':
        return this.formatObject(data, context);
      
      case 'json':
        return this.formatJSON(data, context);
      
      case 'csv':
        return this.formatCSV(data, context);
      
      case 'html':
        return this.formatHTML(data, context);
      
      case 'media':
        return this.formatMedia(data, context);
      
      case 'text':
        return this.formatText(data, context);
      
      case 'number':
        return this.formatNumber(data, context);
      
      default:
        return String(data);
    }
  }

  /**
   * Format recordset (database results)
   */
  formatRecordset(data, context) {
    if (!data.records || data.records.length === 0) {
      return 'No records found.';
    }

    const records = data.records;
    const totalSize = data.totalSize || records.length;
    
    let formatted = `Found ${totalSize} record(s):\n\n`;

    // Show first few records in detail
    const displayCount = Math.min(records.length, 5);
    
    for (let i = 0; i < displayCount; i++) {
      const record = records[i];
      formatted += `**Record ${i + 1}:**\n`;
      
      // Format each field
      for (const [key, value] of Object.entries(record)) {
        if (key !== 'attributes' && value !== null && value !== undefined) {
          const displayValue = this.formatFieldValue(value);
          formatted += `- ${key}: ${displayValue}\n`;
        }
      }
      formatted += '\n';
    }

    // Show summary if more records exist
    if (records.length > displayCount) {
      formatted += `... and ${records.length - displayCount} more record(s)\n`;
    }

    return formatted;
  }

  /**
   * Format array data
   */
  formatArray(data, context) {
    if (data.length === 0) {
      return 'Empty list.';
    }

    if (data.length === 1) {
      return this.formatResponse(data[0], this.detectDataType(data[0]), context);
    }

    // Format as list
    let formatted = `List of ${data.length} items:\n\n`;
    
    const displayCount = Math.min(data.length, 10);
    for (let i = 0; i < displayCount; i++) {
      const item = data[i];
      if (typeof item === 'object') {
        formatted += `${i + 1}. ${this.summarizeObject(item)}\n`;
      } else {
        formatted += `${i + 1}. ${String(item)}\n`;
      }
    }

    if (data.length > displayCount) {
      formatted += `... and ${data.length - displayCount} more items\n`;
    }

    return formatted;
  }

  /**
   * Format object data
   */
  formatObject(data, context) {
    const formatted = [];
    
    for (const [key, value] of Object.entries(data)) {
      const displayValue = this.formatFieldValue(value);
      formatted.push(`**${key}:** ${displayValue}`);
    }

    return formatted.join('\n');
  }

  /**
   * Format JSON string
   */
  formatJSON(data, context) {
    try {
      const parsed = JSON.parse(data);
      return this.formatObject(parsed, context);
    } catch {
      return data;
    }
  }

  /**
   * Format CSV data
   */
  formatCSV(data, context) {
    const lines = data.trim().split('\n');
    if (lines.length === 0) return 'Empty CSV data.';

    const headers = lines[0].split(',').map(h => h.trim());
    
    let formatted = `CSV Data (${lines.length - 1} rows):\n\n`;
    formatted += `**Headers:** ${headers.join(', ')}\n\n`;

    // Show first few rows
    const displayRows = Math.min(lines.length - 1, 5);
    for (let i = 1; i <= displayRows; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      formatted += `**Row ${i}:**\n`;
      
      for (let j = 0; j < headers.length && j < values.length; j++) {
        formatted += `- ${headers[j]}: ${values[j]}\n`;
      }
      formatted += '\n';
    }

    if (lines.length - 1 > displayRows) {
      formatted += `... and ${lines.length - 1 - displayRows} more rows\n`;
    }

    return formatted;
  }

  /**
   * Format HTML content
   */
  formatHTML(data, context) {
    // Extract text content from HTML
    const textContent = data.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    
    if (textContent.length > this.options.maxResponseLength) {
      return textContent.substring(0, this.options.maxResponseLength) + '...';
    }
    
    return textContent;
  }

  /**
   * Format media content
   */
  formatMedia(data, context) {
    const mimeType = data.mimeType || 'unknown';
    const size = data.content ? data.content.length : 0;
    
    return `Media content (${mimeType}, ${this.formatFileSize(size)})`;
  }

  /**
   * Format text content
   */
  formatText(data, context) {
    if (data.length > this.options.maxResponseLength) {
      return data.substring(0, this.options.maxResponseLength) + '...';
    }
    return data;
  }

  /**
   * Format number
   */
  formatNumber(data, context) {
    if (Number.isInteger(data)) {
      return data.toLocaleString();
    } else {
      return data.toFixed(2);
    }
  }

  /**
   * Format field value for display
   */
  formatFieldValue(value) {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    
    if (typeof value === 'object') {
      return this.summarizeObject(value);
    }
    
    if (typeof value === 'string' && value.length > 100) {
      return value.substring(0, 97) + '...';
    }
    
    return String(value);
  }

  /**
   * Summarize object for display
   */
  summarizeObject(obj) {
    if (obj.Name) return obj.Name;
    if (obj.name) return obj.name;
    if (obj.title) return obj.title;
    if (obj.id) return `ID: ${obj.id}`;
    
    const keys = Object.keys(obj);
    if (keys.length <= 3) {
      return JSON.stringify(obj);
    } else {
      return `{${keys.slice(0, 3).join(', ')}, ...}`;
    }
  }

  /**
   * Synthesize multiple responses into a coherent answer
   */
  async synthesizeResponses(responses, context) {
    if (responses.length === 1) {
      return responses[0].formattedResponse;
    }

    let synthesis = 'Based on the information gathered:\n\n';

    // Group responses by success/failure
    const successful = responses.filter(r => r.success && r.confidence > 0.5);
    const failed = responses.filter(r => !r.success || r.confidence <= 0.5);

    // Present successful responses
    if (successful.length > 0) {
      for (const response of successful) {
        synthesis += `**From ${response.toolName}:**\n`;
        synthesis += response.formattedResponse + '\n\n';
      }
    }

    // Note any failures
    if (failed.length > 0) {
      synthesis += `**Note:** Some tools encountered issues:\n`;
      for (const response of failed) {
        synthesis += `- ${response.toolName}: ${response.success ? 'Low confidence result' : 'Failed to execute'}\n`;
      }
    }

    return synthesis;
  }

  /**
   * Extract citations from tool responses
   */
  extractCitations(response, context) {
    const citations = [];
    
    const citation = {
      id: this.generateCitationId(response),
      toolName: response.toolName,
      serverName: response.serverName,
      timestamp: Date.now(),
      url: this.extractSourceUrl(response),
      title: this.extractSourceTitle(response),
      confidence: this.assessResponseQuality(response.result, this.detectDataType(response.result))
    };

    citations.push(citation);
    
    // Track citation for future reference
    this.citationTracker.set(citation.id, citation);
    
    return citations;
  }

  /**
   * Generate citation ID
   */
  generateCitationId(response) {
    const content = JSON.stringify(response.result || '');
    const hash = require('crypto').createHash('md5').update(content).digest('hex');
    return `${response.toolName}_${hash.substring(0, 8)}`;
  }

  /**
   * Extract source URL from response
   */
  extractSourceUrl(response) {
    if (response.metadata && response.metadata.sourceUrl) {
      return response.metadata.sourceUrl;
    }
    
    // Try to find URL in response data
    const data = response.result;
    if (typeof data === 'object' && data.url) {
      return data.url;
    }
    
    return null;
  }

  /**
   * Extract source title from response
   */
  extractSourceTitle(response) {
    if (response.metadata && response.metadata.title) {
      return response.metadata.title;
    }
    
    return `${response.toolName} Result`;
  }

  /**
   * Deduplicate citations
   */
  deduplicateCitations(citations) {
    const seen = new Set();
    return citations.filter(citation => {
      if (seen.has(citation.id)) {
        return false;
      }
      seen.add(citation.id);
      return true;
    });
  }

  /**
   * Extract rich media from responses
   */
  extractRichMedia(responses) {
    const richMedia = [];

    for (const response of responses) {
      if (response.dataType === 'media') {
        richMedia.push({
          type: 'media',
          mimeType: response.rawData.mimeType,
          content: response.rawData.content,
          source: response.toolName
        });
      }

      // Extract charts/visualizations from data
      if (response.dataType === 'recordset' || response.dataType === 'array') {
        const chartData = this.extractChartableData(response.rawData);
        if (chartData) {
          richMedia.push({
            type: 'chart',
            data: chartData,
            source: response.toolName
          });
        }
      }
    }

    return richMedia;
  }

  /**
   * Extract chartable data
   */
  extractChartableData(data) {
    // Simple heuristic for chartable data
    if (data.records && data.records.length > 0) {
      const record = data.records[0];
      const numericFields = [];
      
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'number' && key !== 'Id') {
          numericFields.push(key);
        }
      }

      if (numericFields.length > 0) {
        return {
          type: 'bar',
          labels: data.records.map((r, i) => r.Name || `Record ${i + 1}`),
          datasets: numericFields.map(field => ({
            label: field,
            data: data.records.map(r => r[field] || 0)
          }))
        };
      }
    }

    return null;
  }

  /**
   * Assess response quality
   */
  assessResponseQuality(data, dataType) {
    if (!data) return 0;

    let score = 0.5; // Base score

    switch (dataType) {
      case 'recordset':
        if (data.records && data.records.length > 0) {
          score = Math.min(0.8 + (data.records.length * 0.02), 1.0);
        }
        break;
      
      case 'array':
        if (data.length > 0) {
          score = Math.min(0.7 + (data.length * 0.01), 1.0);
        }
        break;
      
      case 'object':
        const keys = Object.keys(data);
        if (keys.length > 0) {
          score = Math.min(0.6 + (keys.length * 0.05), 1.0);
        }
        break;
      
      case 'text':
        if (typeof data === 'string' && data.length > 10) {
          score = Math.min(0.6 + (data.length * 0.001), 1.0);
        }
        break;
      
      default:
        score = 0.7;
    }

    return score;
  }

  /**
   * Calculate overall confidence
   */
  calculateConfidence(responses) {
    if (responses.length === 0) return 0;

    const successful = responses.filter(r => r.success);
    if (successful.length === 0) return 0;

    const avgConfidence = successful.reduce((sum, r) => sum + r.confidence, 0) / successful.length;
    const successRate = successful.length / responses.length;

    return avgConfidence * successRate;
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Cache response
   */
  cacheResponse(key, response) {
    this.responseCache.set(key, {
      response,
      timestamp: Date.now()
    });

    // Clean old entries
    this.cleanCache();
  }

  /**
   * Get cached response
   */
  getCachedResponse(key) {
    const cached = this.responseCache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.options.cacheTimeout) {
      this.responseCache.delete(key);
      return null;
    }

    return cached.response;
  }

  /**
   * Clean expired cache entries
   */
  cleanCache() {
    const now = Date.now();
    for (const [key, entry] of this.responseCache) {
      if (now - entry.timestamp > this.options.cacheTimeout) {
        this.responseCache.delete(key);
      }
    }
  }

  /**
   * Initialize response formatters
   */
  initializeFormatters() {
    // Custom formatters can be added here
  }

  /**
   * Cleanup resources
   */
  shutdown() {
    this.responseCache.clear();
    this.citationTracker.clear();
    this.removeAllListeners();
  }
}

/**
 * Simple template engine for response formatting
 */
class TemplateEngine {
  constructor() {
    this.templates = new Map();
  }

  /**
   * Register a template
   */
  register(name, template) {
    this.templates.set(name, template);
  }

  /**
   * Render a template with data
   */
  render(name, data) {
    const template = this.templates.get(name);
    if (!template) return '';

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || '';
    });
  }
}

module.exports = { ResponseProcessor, TemplateEngine };