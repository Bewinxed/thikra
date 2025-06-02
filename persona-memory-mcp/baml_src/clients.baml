// Learn more about clients at https://docs.boundaryml.com/docs/snippets/clients/overview

client<llm> CustomGPT4o {
  provider openai
  options {
    model "gpt-4o"
    api_key env.OPENAI_API_KEY
  }
}

client<llm> CustomGPT4oMini {
  provider openai
  retry_policy Exponential
  options {
    model "gpt-4o-mini"
    api_key env.OPENAI_API_KEY
  }
}

client<llm> CustomSonnet {
  provider anthropic
  options {
    model "claude-3-5-sonnet-20241022"
    api_key env.ANTHROPIC_API_KEY
  }
}


client<llm> CustomHaiku {
  provider anthropic
  retry_policy Constant
  options {
    model "claude-3-haiku-20240307"
    api_key env.ANTHROPIC_API_KEY
  }
}



// https://docs.boundaryml.com/docs/snippets/clients/round-robin
client<llm> CustomFast {
  provider round-robin
  options {
    // This will alternate between the two clients
    strategy [CustomGPT4oMini, CustomHaiku]
  }
}

// https://docs.boundaryml.com/docs/snippets/clients/fallback
client<llm> OpenaiFallback {
  provider fallback
  options {
    // This will try the clients in order until one succeeds
    strategy [CustomGPT4oMini, CustomGPT4oMini]
  }
}

// https://docs.boundaryml.com/docs/snippets/clients/retry
retry_policy Constant {
  max_retries 3
  // Strategy is optional
  strategy {
    type constant_delay
    delay_ms 200
  }
}

retry_policy Exponential {
  max_retries 2
  // Strategy is optional
  strategy {
    type exponential_backoff
    delay_ms 300
    multiplier 1.5
    max_delay_ms 10000
  }
}

// OpenRouter clients
client<llm> OpenRouterGPT4o {
  provider openai
  options {
    model "gpt-4o"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
  }
}

client<llm> OpenRouterGeminiFlash25 {
  // powerful, SOTA uncensored model
  provider openai
  options {
    model "google/gemini-2.5-flash-preview-05-20"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
  }
}

client<llm> OpenRouterMistralMini {
  // fast 24b model for low latency
  provider openai
  options {
    model "mistralai/mistral-small-24b-instruct-2501"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
  }
}

client<llm> OpenRouterMinistral {
  // ultra fast 3b model for common llm tasks
  provider openai
  options {
    model "mistralai/ministral-3b"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
  }
}

client<llm> OpenRouterHaiku {
  provider openai
  options {
    model "anthropic/claude-3.5-haiku-20241022"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
    temperature 0.3  // Lower temperature for more consistent extraction
  }
}

client<llm> OpenRouterSonnet {
  provider openai
  options {
    model "anthropic/claude-3.5-sonnet"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
  }
}

// DeepSeek client for handling intimate persona content
client<llm> OpenRouterDeepSeek {
  provider openai
  options {
    model "deepseek/deepseek-chat"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
    temperature 0.4  // Slightly higher for understanding nuanced content
    request_timeout 120000  // 2 minute timeout
  }
}

// GPT-4o-mini for persona extraction (less restrictive)
client<llm> OpenRouterGPT4oMini {
  provider openai
  options {
    model "openai/gpt-4o-mini"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
    temperature 0.3
  }
}

// Fallback client for persona extraction - tries multiple models
client<llm> PersonaExtractionFallback {
  provider fallback
  options {
    strategy [OpenRouterGPT4oMini, OpenRouterDeepSeek, OpenRouterHaiku]
  }
}

// Sonnet with prompt caching support for complex functions
client<llm> OpenRouterSonnetWithCache {
  provider openai
  options {
    model "anthropic/claude-sonnet-4"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
      "anthropic-beta" "prompt-caching-2024-07-31"
    }
    allowed_role_metadata ["cache_control"]
    temperature 0.4
  }
}

// Fallback for large model functions: Sonnet -> Gemini
client<llm> LargeModelFallback {
  provider fallback
  options {
    strategy [OpenRouterSonnetWithCache, OpenRouterGeminiFlash25]
  }
}

// Client for simple pattern matching tasks
client<llm> OpenRouterMistralSmall {
  provider openai
  options {
    model "mistralai/mistral-small-24b-instruct-2501"
    api_key env.OPENROUTER_API_KEY
    base_url "https://openrouter.ai/api/v1"
    headers {
      "HTTP-Referer" "https://persona-memory.local"
      "X-Title" "Persona Memory MCP"
    }
    temperature 0.2  // Lower temperature for consistent extraction
  }
}