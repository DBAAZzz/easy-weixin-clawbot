export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchRequest {
  query: string;
  maxResults: number;
  signal: AbortSignal;
}

export interface WebSearchResponse {
  provider: string;
  results: WebSearchResult[];
}

export interface WebFetchRequest {
  url: string;
  signal: AbortSignal;
}

export interface WebFetchResponse {
  title: string | null;
  url: string;
  content: string;
}

export interface WebToolService {
  search(request: WebSearchRequest): Promise<WebSearchResponse>;
  fetch(request: WebFetchRequest): Promise<WebFetchResponse>;
}

let service: WebToolService | null = null;

export function setWebToolService(impl: WebToolService): void {
  service = impl;
}

export function getWebToolService(): WebToolService {
  if (!service) {
    throw new Error("WebToolService not initialized — call setWebToolService() at startup");
  }
  return service;
}