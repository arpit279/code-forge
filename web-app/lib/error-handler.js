/**
 * Advanced Error Handling and Monitoring System
 * Provides comprehensive error handling, retry logic, and monitoring
 */

const EventEmitter = require('events');

class ErrorHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      backoffMultiplier: options.backoffMultiplier || 2,
      maxRetryDelay: options.maxRetryDelay || 30000,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
      circuitBreakerTimeout: options.circuitBreakerTimeout || 60000,
      enableMetrics: options.enableMetrics !== false,
      ...options
    };

    this.errorCounts = new Map();
    this.retryAttempts = new Map();
    this.circuitBreakers = new Map();
    this.errorMetrics = new Map();
    this.timeouts = new Map();
    
    this.initializeMetrics();
  }

  /**
   * Execute operation with error handling and retry logic
   */
  async executeWithRetry(operation, operationId, options = {}) {
    const config = { ...this.options, ...options };
    const startTime = Date.now();
    let lastError;

    // Check circuit breaker
    if (this.isCircuitOpen(operationId)) {
      throw new Error(`Circuit breaker is open for operation: ${operationId}`);
    }

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        // Set timeout if specified
        let result;
        if (config.timeout) {
          result = await this.withTimeout(operation, config.timeout, operationId);
        } else {
          result = await operation();
        }

        // Record success
        this.recordSuccess(operationId, Date.now() - startTime);
        this.resetRetryCount(operationId);
        
        return result;

      } catch (error) {
        lastError = error;
        this.recordError(operationId, error, attempt);

        // Don't retry on certain error types
        if (this.shouldNotRetry(error)) {
          break;
        }

        // Don't retry on last attempt
        if (attempt === config.maxRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = this.calculateRetryDelay(attempt, config);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    this.recordFinalFailure(operationId, lastError);
    throw new OperationError(
      `Operation failed after ${config.maxRetries + 1} attempts: ${lastError.message}`,
      operationId,
      lastError
    );
  }

  /**
   * Execute operation with timeout
   */
  async withTimeout(operation, timeoutMs, operationId) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.timeouts.delete(operationId);
        reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`, operationId));
      }, timeoutMs);

      this.timeouts.set(operationId, timeoutId);

      try {
        const result = await operation();
        clearTimeout(timeoutId);
        this.timeouts.delete(operationId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        this.timeouts.delete(operationId);
        reject(error);
      }
    });
  }

  /**
   * Handle HTTP-specific errors
   */
  handleHttpError(response, context = {}) {
    const error = new HttpError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      response.statusText,
      context
    );

    this.emit('httpError', error);
    return error;
  }

  /**
   * Handle JSON-RPC errors
   */
  handleJsonRpcError(errorResponse, context = {}) {
    const error = new JsonRpcError(
      errorResponse.error.message,
      errorResponse.error.code,
      errorResponse.error.data,
      context
    );

    this.emit('jsonRpcError', error);
    return error;
  }

  /**
   * Handle validation errors
   */
  handleValidationError(message, field, value, context = {}) {
    const error = new ValidationError(message, field, value, context);
    this.emit('validationError', error);
    return error;
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen(operationId) {
    const breaker = this.circuitBreakers.get(operationId);
    if (!breaker) return false;

    if (breaker.state === 'open') {
      // Check if timeout period has passed
      if (Date.now() - breaker.openTime > this.options.circuitBreakerTimeout) {
        breaker.state = 'half-open';
        breaker.consecutiveFailures = 0;
      } else {
        return true;
      }
    }

    return false;
  }

  /**
   * Record successful operation
   */
  recordSuccess(operationId, duration) {
    // Update circuit breaker
    const breaker = this.circuitBreakers.get(operationId);
    if (breaker) {
      if (breaker.state === 'half-open') {
        breaker.state = 'closed';
        breaker.consecutiveFailures = 0;
      }
    }

    // Update metrics
    if (this.options.enableMetrics) {
      const metrics = this.getOrCreateMetrics(operationId);
      metrics.successCount++;
      metrics.totalDuration += duration;
      metrics.averageDuration = metrics.totalDuration / metrics.successCount;
      metrics.lastSuccess = Date.now();
    }

    this.emit('operationSuccess', { operationId, duration });
  }

  /**
   * Record error occurrence
   */
  recordError(operationId, error, attempt) {
    // Update error counts
    const errorKey = `${operationId}_${error.constructor.name}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    // Update circuit breaker
    const breaker = this.getOrCreateCircuitBreaker(operationId);
    breaker.consecutiveFailures++;
    
    if (breaker.consecutiveFailures >= this.options.circuitBreakerThreshold) {
      breaker.state = 'open';
      breaker.openTime = Date.now();
      this.emit('circuitBreakerOpened', { operationId, error });
    }

    // Update metrics
    if (this.options.enableMetrics) {
      const metrics = this.getOrCreateMetrics(operationId);
      metrics.errorCount++;
      metrics.lastError = Date.now();
      metrics.errorTypes.set(error.constructor.name, 
        (metrics.errorTypes.get(error.constructor.name) || 0) + 1);
    }

    this.emit('operationError', { operationId, error, attempt });
  }

  /**
   * Record final failure after all retries
   */
  recordFinalFailure(operationId, error) {
    if (this.options.enableMetrics) {
      const metrics = this.getOrCreateMetrics(operationId);
      metrics.finalFailureCount++;
    }

    this.emit('operationFinalFailure', { operationId, error });
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(attempt, config) {
    const baseDelay = config.retryDelay || this.options.retryDelay;
    const multiplier = config.backoffMultiplier || this.options.backoffMultiplier;
    const maxDelay = config.maxRetryDelay || this.options.maxRetryDelay;

    const delay = baseDelay * Math.pow(multiplier, attempt);
    return Math.min(delay, maxDelay);
  }

  /**
   * Check if error should not be retried
   */
  shouldNotRetry(error) {
    // Don't retry validation errors
    if (error instanceof ValidationError) return true;
    
    // Don't retry authentication errors
    if (error instanceof HttpError && error.status === 401) return true;
    
    // Don't retry forbidden errors
    if (error instanceof HttpError && error.status === 403) return true;
    
    // Don't retry not found errors
    if (error instanceof HttpError && error.status === 404) return true;
    
    // Don't retry bad request errors
    if (error instanceof HttpError && error.status === 400) return true;

    // Don't retry JSON-RPC method not found
    if (error instanceof JsonRpcError && error.code === -32601) return true;

    // Don't retry invalid params
    if (error instanceof JsonRpcError && error.code === -32602) return true;

    return false;
  }

  /**
   * Get or create circuit breaker for operation
   */
  getOrCreateCircuitBreaker(operationId) {
    if (!this.circuitBreakers.has(operationId)) {
      this.circuitBreakers.set(operationId, {
        state: 'closed', // closed, open, half-open
        consecutiveFailures: 0,
        openTime: null
      });
    }
    return this.circuitBreakers.get(operationId);
  }

  /**
   * Get or create metrics for operation
   */
  getOrCreateMetrics(operationId) {
    if (!this.errorMetrics.has(operationId)) {
      this.errorMetrics.set(operationId, {
        operationId,
        successCount: 0,
        errorCount: 0,
        finalFailureCount: 0,
        totalDuration: 0,
        averageDuration: 0,
        lastSuccess: null,
        lastError: null,
        errorTypes: new Map()
      });
    }
    return this.errorMetrics.get(operationId);
  }

  /**
   * Reset retry count for operation
   */
  resetRetryCount(operationId) {
    this.retryAttempts.delete(operationId);
  }

  /**
   * Get error statistics
   */
  getErrorStats(operationId = null) {
    if (operationId) {
      return this.errorMetrics.get(operationId) || null;
    }

    const stats = {
      totalOperations: this.errorMetrics.size,
      totalErrors: 0,
      totalSuccesses: 0,
      operationStats: {}
    };

    for (const [id, metrics] of this.errorMetrics) {
      stats.totalErrors += metrics.errorCount;
      stats.totalSuccesses += metrics.successCount;
      
      stats.operationStats[id] = {
        ...metrics,
        errorTypes: Object.fromEntries(metrics.errorTypes)
      };
    }

    return stats;
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(operationId = null) {
    if (operationId) {
      return this.circuitBreakers.get(operationId) || null;
    }

    const status = {};
    for (const [id, breaker] of this.circuitBreakers) {
      status[id] = { ...breaker };
    }

    return status;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(operationId) {
    const breaker = this.circuitBreakers.get(operationId);
    if (breaker) {
      breaker.state = 'closed';
      breaker.consecutiveFailures = 0;
      breaker.openTime = null;
    }
  }

  /**
   * Clear all error tracking data
   */
  clearErrorData(operationId = null) {
    if (operationId) {
      this.errorCounts.delete(operationId);
      this.retryAttempts.delete(operationId);
      this.circuitBreakers.delete(operationId);
      this.errorMetrics.delete(operationId);
      
      // Clear timeout if exists
      const timeoutId = this.timeouts.get(operationId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.timeouts.delete(operationId);
      }
    } else {
      this.errorCounts.clear();
      this.retryAttempts.clear();
      this.circuitBreakers.clear();
      this.errorMetrics.clear();
      
      // Clear all timeouts
      for (const timeoutId of this.timeouts.values()) {
        clearTimeout(timeoutId);
      }
      this.timeouts.clear();
    }
  }

  /**
   * Initialize metrics collection
   */
  initializeMetrics() {
    if (this.options.enableMetrics) {
      // Periodically clean up old metrics
      setInterval(() => {
        this.cleanupOldMetrics();
      }, 300000); // 5 minutes
    }
  }

  /**
   * Clean up old metrics
   */
  cleanupOldMetrics() {
    const maxAge = 3600000; // 1 hour
    const now = Date.now();

    for (const [operationId, metrics] of this.errorMetrics) {
      const lastActivity = Math.max(metrics.lastSuccess || 0, metrics.lastError || 0);
      if (lastActivity && (now - lastActivity) > maxAge) {
        this.clearErrorData(operationId);
      }
    }
  }

  /**
   * Sleep for specified duration
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown and cleanup
   */
  shutdown() {
    // Clear all timeouts
    for (const timeoutId of this.timeouts.values()) {
      clearTimeout(timeoutId);
    }
    
    this.clearErrorData();
    this.removeAllListeners();
  }
}

/**
 * Custom error classes
 */
class OperationError extends Error {
  constructor(message, operationId, originalError) {
    super(message);
    this.name = 'OperationError';
    this.operationId = operationId;
    this.originalError = originalError;
  }
}

class TimeoutError extends Error {
  constructor(message, operationId) {
    super(message);
    this.name = 'TimeoutError';
    this.operationId = operationId;
  }
}

class HttpError extends Error {
  constructor(message, status, statusText, context = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.context = context;
  }
}

class JsonRpcError extends Error {
  constructor(message, code, data, context = {}) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
    this.context = context;
  }
}

class ValidationError extends Error {
  constructor(message, field, value, context = {}) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.context = context;
  }
}

module.exports = {
  ErrorHandler,
  OperationError,
  TimeoutError,
  HttpError,
  JsonRpcError,
  ValidationError
};