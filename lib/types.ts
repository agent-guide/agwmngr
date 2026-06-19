export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const ErrNotFound = "not found";
export const ErrReadOnly = "read-only";
export const ErrConflict = "conflict";

export interface TLSConf {
  auto?: boolean;
  cert_file?: string;
  key_file?: string;
}

export interface ServerRequest {
  id: string;
  listen: string[];
  tls?: TLSConf;
}

export interface ServerResponse {
  id: string;
  listen: string[];
  routes?: RouteResponse[];
  readonly?: boolean;
  source?: string;
  public_url?: string;
}

export interface MatchConf {
  paths?: string[];
  hosts?: string[];
}

export interface HandlerConf {
  type: string;
  apis?: string[];
  upstream?: string;
  root?: string;
}

export interface RouteRequest {
  id: string;
  order: number;
  match: MatchConf;
  handlers: HandlerConf[];
}

export interface RouteResponse {
  id: string;
  order: number;
  match: MatchConf;
  handlers: HandlerConf[];
}

// Caddy internal JSON types

export interface CaddyTLSAutomation {
  policies: Record<string, unknown>[];
}

export interface CaddyTLS {
  automation?: CaddyTLSAutomation;
}

export interface CaddyMatch {
  path?: string[];
  host?: string[];
}

export type CaddyHandler = Record<string, unknown>;

export interface CaddyRoute {
  group?: string;
  match?: CaddyMatch[];
  handle: CaddyHandler[];
  terminal?: boolean;
}

export interface CaddyServer {
  listen: string[];
  routes?: CaddyRoute[];
  tls?: CaddyTLS;
}
