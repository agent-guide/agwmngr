import { expect, test } from "bun:test";
import {
  isPlatformGatewayInfrastructureRouteMutation,
  platformGatewayInfrastructureTarget,
} from "./platform-gateway-infrastructure";

test("Gateway infrastructure mapping allows only reviewed method and path shapes", () => {
  expect(platformGatewayInfrastructureTarget("GET", ["llm", "providers"]))
    .toBe("/admin/llm/providers");
  expect(platformGatewayInfrastructureTarget("PUT", ["llm", "providers", "openai"]))
    .toBe("/admin/llm/providers/openai");
  expect(platformGatewayInfrastructureTarget("POST", ["llm", "models", "providers", "openai", "refresh"]))
    .toBe("/admin/llm/models/providers/openai/refresh");
  expect(platformGatewayInfrastructureTarget("GET", ["mcp", "services", "docs", "tools"]))
    .toBe("/admin/mcp/services/docs/tools");

  expect(platformGatewayInfrastructureTarget("DELETE", ["llm", "provider_types"])).toBeNull();
  expect(platformGatewayInfrastructureTarget("POST", ["mcp", "runtime"])).toBeNull();
  expect(platformGatewayInfrastructureTarget("POST", ["mcp", "services", "docs", "tools", "call"]))
    .toBeNull();
  expect(platformGatewayInfrastructureTarget("POST", ["mcp", "services", "docs", "resources", "read"]))
    .toBeNull();
  expect(platformGatewayInfrastructureTarget("GET", ["agents"])).toBeNull();
  expect(platformGatewayInfrastructureTarget("GET", ["llm", "providers", ".."]))
    .toBeNull();
});

test("Gateway infrastructure route writes use the shared mutation barrier", () => {
  expect(isPlatformGatewayInfrastructureRouteMutation("POST", ["llm", "routes"]))
    .toBeTrue();
  expect(isPlatformGatewayInfrastructureRouteMutation("PUT", ["mcp", "routes", "mcp:docs:/docs"]))
    .toBeTrue();
  expect(isPlatformGatewayInfrastructureRouteMutation("POST", ["llm", "routes", "chat", "enable"]))
    .toBeTrue();
  expect(isPlatformGatewayInfrastructureRouteMutation("GET", ["llm", "routes"]))
    .toBeFalse();
  expect(isPlatformGatewayInfrastructureRouteMutation("POST", ["llm", "providers"]))
    .toBeFalse();
  expect(isPlatformGatewayInfrastructureRouteMutation("PATCH", ["llm", "routes", "chat"]))
    .toBeFalse();
});
