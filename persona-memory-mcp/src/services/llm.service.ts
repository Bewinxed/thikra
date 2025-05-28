import OpenAI from 'openai';

export class LLMService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://persona-memory.local',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Persona Memory MCP',
      },
    });
  }

  /**
   * Create a chat completion with OpenRouter
   */
  async createChatCompletion(
    params: Omit<OpenAI.ChatCompletionCreateParams, 'model'>,
  ): Promise<OpenAI.ChatCompletion> {
    const { stream, ...restParams } = params as OpenAI.ChatCompletionCreateParamsNonStreaming;
    return this.openai.chat.completions.create({
      ...restParams,
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307',
      stream: false,
    }) as Promise<OpenAI.ChatCompletion>;
  }

  /**
   * Create a JSON mode chat completion
   */
  async createJSONCompletion<T = Record<string, unknown>>(
    messages: OpenAI.ChatCompletionMessageParam[],
    temperature?: number,
  ): Promise<T> {
    const response = await this.createChatCompletion({
      messages,
      temperature,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message.content;
    return JSON.parse(content || '{}') as T;
  }
}
