# Intelligent Query Refinement System

## Overview

The Query Refinement System automatically detects failed queries and applies intelligent strategies to refine and retry them until successful results are achieved. This system mimics Claude's behavior of automatically refining queries like the example where "Moore & Sons" was refined to "Moore Sons" when the original query failed.

## How It Works

### 1. **Automatic Error Detection**
The system monitors tool execution results and detects common error patterns:
- `MALFORMED_SEARCH` errors in SOSL queries
- `INVALID_FIELD` errors in SOQL queries  
- Syntax errors and parsing failures
- Timeout and rate limit issues

### 2. **Intelligent Refinement Strategies**
When a query fails, the system applies multiple refinement strategies in order of effectiveness:

#### **SOSL Query Strategies:**
- **Remove Special Characters**: Strips `&`, `+`, `-`, `()`, `{}`, `[]`, `"`, `'` that cause parsing errors
- **Split Compound Terms**: Converts "Moore & Sons" → "Moore Sons"  
- **Escape Special Characters**: Properly escapes special characters
- **Quote Individual Terms**: Wraps terms in quotes for exact matching
- **Add Wildcards**: Adds `*` for partial matching
- **Simplify to First Word**: Uses only the most significant term

#### **SOQL Query Strategies:**
- **Escape Single Quotes**: Properly handles quotes in WHERE clauses
- **Fix LIKE Wildcards**: Ensures LIKE clauses have proper `%` wildcards
- **Simplify WHERE Clause**: Reduces complex conditions to first condition only
- **Remove Invalid Fields**: Falls back to basic fields like `Id, Name`

#### **General Strategies:**
- **Reduce Complexity**: Adds or reduces LIMIT clauses
- **Handle Encoding Issues**: Removes non-ASCII characters

### 3. **Learning System**
The system learns from successful and failed refinements:
- Tracks which strategies work best for different error types
- Prioritizes successful strategies in future refinements
- Maintains success/failure statistics for continuous improvement

## Usage Examples

### Example 1: Special Character Handling
```javascript
// Original query fails
FIND {Moore & Sons} IN ALL FIELDS RETURNING Account(Id, Name)
// Error: "No search term found. The search term must be enclosed in braces."

// Automatically refined to:
FIND {Moore Sons} IN ALL FIELDS RETURNING Account(Id, Name)
// Success! ✅
```

### Example 2: SOQL Quote Escaping  
```javascript
// Original query fails
SELECT Id, Name FROM Account WHERE Name = 'O'Brien Corp'
// Error: "MALFORMED_QUERY"

// Automatically refined to:
SELECT Id, Name FROM Account WHERE Name = 'O\'Brien Corp'
// Success! ✅
```

### Example 3: Complex Query Simplification
```javascript
// Original query fails
SELECT Id, Name, CustomField__c, AnotherField__c FROM Account WHERE Name LIKE '%test%' AND Industry = 'Tech' AND Rating = 'Hot'
// Error: "No such column 'CustomField__c'"

// Automatically refined to:
SELECT Id, Name FROM Account WHERE Name LIKE '%test%'
// Success! ✅
```

## API Integration

### Direct Query Refinement
```javascript
// Test query refinement directly
POST /api/query-refine
{
  "query": "Moore & Sons",
  "queryType": "salesforce_search",
  "toolName": "salesforce_search"
}

// Response includes refinement details
{
  "success": true,
  "result": { /* actual results */ },
  "originalQuery": "FIND {Moore & Sons} IN ALL FIELDS...",
  "finalQuery": "FIND {Moore Sons} IN ALL FIELDS...", 
  "attempts": 2,
  "refinements": [
    {
      "strategy": "split_compound_terms",
      "description": "Split compound search terms",
      "query": "FIND {Moore Sons} IN ALL FIELDS..."
    }
  ],
  "successfulStrategy": "split_compound_terms"
}
```

### Chat Integration
The sophisticated chat endpoint automatically uses query refinement:

```javascript
POST /api/chat
{
  "messages": [{"role": "user", "content": "Tell me about Moore & Sons"}],
  "model": "llama3",
  "sessionId": "user123"
}

// Response includes refinement information
{
  "response": "Here's information about Moore & Sons...",
  "sophisticatedMCP": true,
  "queryRefinements": [
    {
      "tool": "salesforce_search",
      "originalQuery": "FIND {Moore & Sons}...",
      "finalQuery": "FIND {Moore Sons}...", 
      "attempts": 2,
      "successfulStrategy": "split_compound_terms"
    }
  ]
}
```

## Configuration

### System Configuration
```javascript
const mcpSystem = new MCPSystem({
  queryRefiner: {
    maxRetries: 5,           // Maximum refinement attempts
    retryDelay: 500,         // Delay between attempts (ms)
    enableLearning: true     // Enable success/failure learning
  }
});
```

### Custom Refinement Strategies
Add domain-specific refinement strategies:

```javascript
mcpSystem.queryRefiner.queryRefiner.addStrategy('salesforce_search', {
  name: 'custom_company_name_handler',
  description: 'Handle company name variations',
  apply: (query, error) => {
    if (error.includes('MALFORMED_SEARCH')) {
      // Custom logic for company names
      return query.replace(/\s+(Inc|Corp|LLC|Ltd)\.?\s*/gi, ' $1');
    }
    return null;
  }
});
```

## Monitoring and Analytics

### Query Refinement Statistics
```javascript
GET /api/query-stats

{
  "successPatterns": {
    "salesforce_search_success": {
      "special_char_removal": 15,
      "compound_term_split": 23,
      "wildcard_addition": 8
    }
  },
  "failurePatterns": {
    "salesforce_search_failures": {
      "quote_individual_terms:malformed": 3,
      "use_wildcards:timeout": 1
    }
  },
  "totalSuccesses": 46,
  "totalFailures": 4,
  "successRate": 0.92
}
```

### System-Wide Statistics
```javascript
GET /api/mcp-stats

{
  "queryRefinement": {
    "successRate": 0.92,
    "totalSuccesses": 46,
    "totalFailures": 4,
    "successPatterns": { /* ... */ },
    "failurePatterns": { /* ... */ }
  },
  // ... other system stats
}
```

## Benefits

### 1. **Improved User Experience**
- Users don't need to manually fix query syntax
- Automatic handling of special characters and formatting issues
- Seamless fallback when queries fail

### 2. **Higher Success Rates**
- Up to 5 refinement attempts per query
- Multiple strategies for different error types
- Learning system improves over time

### 3. **Reduced Support Burden**
- Fewer user complaints about "query not working"
- Automatic handling of common syntax issues
- Detailed logging for debugging

### 4. **Intelligent Adaptation**
- System learns which strategies work best
- Adapts to new error patterns automatically  
- Continuous improvement through usage analytics

## Error Handling

### Fail-Safe Mechanisms
- **Attempt Limits**: Maximum 5 refinement attempts to prevent infinite loops
- **Timeout Protection**: Each refinement has timeout limits
- **Graceful Degradation**: Falls back to original error if all refinements fail
- **Circuit Breakers**: Prevents cascade failures in high-error scenarios

### Logging and Debugging
```javascript
// Detailed logging for each refinement attempt
console.log(`🔄 Query refinement attempt 2/5`);
console.log(`Strategy: split_compound_terms`);
console.log(`Original: FIND {Moore & Sons}...`);
console.log(`Refined:  FIND {Moore Sons}...`);
console.log(`✅ Success after 2 attempts`);
```

## Future Enhancements

### 1. **Machine Learning Integration**
- Use ML models to predict best refinement strategies
- Analyze query patterns for proactive optimization
- Personalized refinement based on user behavior

### 2. **Natural Language Understanding**
- Parse user intent to suggest better query structures
- Convert natural language to optimal query syntax
- Context-aware query generation

### 3. **Performance Optimization**
- Parallel strategy testing
- Caching of successful refinements
- Predictive pre-refinement for common patterns

## Best Practices

### 1. **Strategy Ordering**
- Place most successful strategies first
- Use learning data to reorder strategies
- Consider error-specific strategy selection

### 2. **Resource Management**
- Set appropriate retry limits
- Monitor system resource usage
- Implement rate limiting for refinement attempts

### 3. **Error Analysis**
- Regularly review failure patterns
- Add new strategies for emerging error types
- Monitor success rates and adjust thresholds

This intelligent query refinement system ensures that users get successful results even when their initial queries have syntax issues or formatting problems, significantly improving the overall user experience and system reliability.