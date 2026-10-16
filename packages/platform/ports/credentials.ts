export interface IssuedServiceCredential {
  id: string;
  token: string;
  digest: string;
}

export interface ServiceCredentialIssuer {
  issue(): IssuedServiceCredential;
  digest(token: string): string;
}
