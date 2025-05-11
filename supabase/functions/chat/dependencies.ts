// Import SupabaseClient type and the shared helper function
import { createSupabaseClient } from '../_shared/auth.ts';
import type { ChatHandlerDeps } from '../_shared/types.ts';
// Other shared imports
import { handleCorsPreflightRequest } from '../_shared/cors-headers.ts';
// No longer need direct env access here, shared function handles it
// No longer need direct createClient import here

// Define the interface for dependencies
// This allows mocking for tests

// Define the structure for an AI Provider (can be moved to a shared types file later)
// Ensure this matches the structure expected by the chat function and potential DB results
interface AiProviderConfig {
  id: string; 
  name: string;
  apiKeyEnvVar: string | null; // Env var name for the API key (null is valid)
  baseUrl: string | undefined;      // Base URL for the API (undefined is possible from DB)
  defaultModel: string | undefined; // Default model identifier (undefined is possible from DB)
}

// Define the default provider configuration directly here
// Ensure required fields have non-null/undefined values
export const defaultProvider: AiProviderConfig = {
  id: '__default_openai__', // Internal identifier for the default
  name: 'Default OpenAI',   // User-friendly name
  apiKeyEnvVar: 'OPENAI_API_KEY', // Default environment variable to check
  baseUrl: 'https://api.openai.com/v1/chat/completions', // Default OpenAI URL
  defaultModel: 'gpt-4o', // Default model (adjust as needed)
};

// Helper function for creating JSON responses (moved here or keep shared)
export function createJsonResponse(data: unknown, status = 200, headers = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...handleCorsPreflightRequest, 'Content-Type': 'application/json', ...headers },
    status: status,
  });
}

// Helper function for creating error responses (moved here or keep shared)
export function createErrorResponse(message: string, status = 500, headers = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...handleCorsPreflightRequest, 'Content-Type': 'application/json', ...headers },
    status: status,
  });
}

// Create default dependencies using actual implementations
export const defaultDeps: ChatHandlerDeps = {
  // Use the shared helper function from auth.ts
  createSupabaseClient: createSupabaseClient,
  // Remove getEnv if no longer directly needed
  // getEnv: Deno.env.get,
  fetch: fetch,
  corsHeaders: handleCorsPreflightRequest,
  createJsonResponse: createJsonResponse,
  createErrorResponse: createErrorResponse,
}; 