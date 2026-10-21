import { expect, test } from "bun:test";
import {
  platformAgentHref,
  platformAgentTab,
  platformAgentTenantId,
} from "./platform-agent-ui";

test("platform Agent workspace uses stable canonical tabs", () => {
  expect(platformAgentTenantId("agent:alpha:support")).toBe("alpha");
  expect(platformAgentTenantId("gateway-agent")).toBeNull();
  expect(platformAgentTab("overview")).toBe("overview");
  expect(platformAgentTab("releases")).toBe("releases");
  expect(platformAgentTab("unknown")).toBeNull();
  expect(platformAgentHref("agent:alpha:support", "observability"))
    .toBe("/dashboard/agents/agent%3Aalpha%3Asupport/observability");
});
