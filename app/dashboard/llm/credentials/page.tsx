"use client";

import { GatewayCredentialsPage, type GatewayCredentialsAdapter } from "@/components/gateway-credentials-page";
import {
  createCredential,
  deleteCredential,
  listCredentials,
  listProviders,
  updateCredential,
} from "@/lib/api";

const legacyGatewayCredentials: GatewayCredentialsAdapter = {
  listCredentials,
  listProviders,
  createCredential,
  updateCredential,
  deleteCredential,
};

export default function CredentialsPage() {
  return <GatewayCredentialsPage api={legacyGatewayCredentials} />;
}
